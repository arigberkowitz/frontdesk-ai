import "server-only";
import { and, desc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { appointments, clients, reminders, type Client } from "@/db/schema";
import { createReminder } from "@/lib/data/reminders";
import { filterByFeature } from "@/lib/plan-access";
import { isDeliverableUrl } from "@/lib/webhooks-out";
import { loadTextHistory, spamPhoneKeys } from "@/lib/data/revenue-texts";
import { revenueClientGate, sendRevenueTexts, type RevenueRecipient } from "@/lib/revenue-send";
import { MIN_DAYS_BETWEEN_REVENUE_TEXTS, phoneKey } from "@/lib/revenue-texts";
import {
  REVIEW_MAX_AGE_HOURS,
  REVIEW_MIN_DAYS_BETWEEN,
  reviewDelayOf,
  reviewRequestBody,
  shouldAskForReview,
  type ReviewCandidate,
} from "@/lib/review-requests";
import { logger } from "@/lib/logger";
import { mapLimit, outOfBudget } from "./util";

/**
 * Ask the customers we just served to say so publicly (Pro).
 *
 * For a local service business, search reviews decide who gets called at all,
 * and the moment to ask is a couple of hours after the visit. Guardrails:
 *  - Pro only, enforced here (filterByFeature) and in the settings action
 *  - opt-in per business, and useless without a review link they chose
 *  - waits the owner's delay after the appointment ends (default 2 hours)
 *  - one ask per appointment, never twice to the same number within 90 days
 *  - the shared revenue-text fence (revenue-send.ts): consent, STOP, owner
 *    blocks, spam numbers, the business's send hours, per-person cap across
 *    all follow-ups, Spanish texts, a clean skip while texting isn't approved
 *  - templated body, never model-written, and no review gating: everyone gets
 *    the same direct ask
 */

const MAX_SENDS_PER_CLIENT = 25;

export interface ReviewRunResult {
  clientId: string;
  clientName: string;
  sent: number;
  skipped?: string;
}

export async function requestReviewsForClient(client: Client, now = new Date()): Promise<ReviewRunResult> {
  const base: ReviewRunResult = { clientId: client.id, clientName: client.name, sent: 0 };

  const reviewUrl = client.reviewUrl?.trim();
  if (!reviewUrl) return { ...base, skipped: "no_review_url" };
  // The same fence the outbound webhooks use. This URL is typed by a customer
  // and then texted to THEIR customers; an http link in a text from a business
  // is a phishing lesson nobody needs.
  if (!isDeliverableUrl(reviewUrl)) return { ...base, skipped: "review_url_not_allowed" };

  const gate = await revenueClientGate(client, now);
  if (gate) return { ...base, skipped: gate };

  const delayHours = reviewDelayOf(client.setupFlags);
  try {
    // The window: ended long enough ago to ask, recently enough to be welcome.
    const newest = new Date(now.getTime() - delayHours * 3_600_000);
    const oldest = new Date(now.getTime() - REVIEW_MAX_AGE_HOURS * 3_600_000);
    const recent = await db.query.appointments.findMany({
      where: and(
        eq(appointments.clientId, client.id),
        inArray(appointments.status, ["booked", "confirmed"]),
        gte(appointments.startAt, oldest),
        lte(appointments.startAt, newest),
        isNull(appointments.deletedAt),
      ),
      orderBy: [desc(appointments.startAt)],
      limit: 100,
    });
    if (recent.length === 0) return { ...base, skipped: "nothing_to_ask_about" };

    // Per appointment: was this visit already asked about?
    const asked = await db.query.reminders.findMany({
      where: and(
        eq(reminders.clientId, client.id),
        eq(reminders.kind, "review_request"),
        inArray(
          reminders.appointmentId,
          recent.map((a) => a.id),
        ),
      ),
      columns: { appointmentId: true },
    });
    const askedAppointment = new Set(asked.map((r) => r.appointmentId).filter(Boolean));
    // Per number: any review request in the last 90 days, whatever visit it
    // was about — read from the texts themselves, so it holds across visits.
    const [history, spam] = await Promise.all([
      loadTextHistory(client.id, "review_request", {
        kindWindowDays: REVIEW_MIN_DAYS_BETWEEN,
        capWindowDays: MIN_DAYS_BETWEEN_REVENUE_TEXTS,
        now,
      }),
      spamPhoneKeys(client.id, now),
    ]);

    const due = recent.filter((a) => {
      const candidate: ReviewCandidate = {
        appointmentId: a.id,
        customerName: a.customerName,
        customerPhone: a.customerPhone,
        status: a.status,
        startAt: a.startAt,
        endAt: a.endAt,
        askedAt: askedAppointment.has(a.id) ? new Date(0) : null,
        lastAskedThisPhoneAt: history.lastOfKind.get(phoneKey(a.customerPhone) ?? "") ?? null,
      };
      return shouldAskForReview(candidate, now, delayHours);
    });
    if (due.length === 0) return { ...base, skipped: "nothing_due" };

    const recipients: RevenueRecipient[] = due.map((appt) => ({
      phone: appt.customerPhone!,
      appointmentId: appt.id,
      body: (language) => reviewRequestBody({ businessName: client.name, customerName: appt.customerName, reviewUrl, language }),
      onAttempt: async (res) => {
        await createReminder(client.id, {
          appointmentId: appt.id,
          leadId: null,
          channel: "sms",
          kind: "review_request",
          status: res.ok ? "sent" : "failed",
          sentAt: res.ok ? now : null,
          error: res.ok ? null : (res.error ?? "Send failed"),
        });
      },
    }));
    const res = await sendRevenueTexts(client, {
      kind: "review_request",
      purpose: "review_request",
      recipients,
      history,
      spam,
      maxSends: MAX_SENDS_PER_CLIENT,
      now,
    });
    logger.info("review_requests.run", { clientId: client.id, due: due.length, ...res });
    return {
      ...base,
      sent: res.sent + res.queued,
      ...(res.providerUnavailable ? { skipped: "sms_not_configured" } : {}),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("agents.reviews.failed", { clientId: client.id, error: message });
    return { ...base, skipped: `error: ${message}` };
  }
}

/** Entry point: every business that turned this on AND is on Pro. */
export async function runReviewRequests(budgetMs = 240_000, now = new Date()): Promise<ReviewRunResult[]> {
  const deadline = Date.now() + budgetMs;
  const enabled = await db.query.clients.findMany({
    where: and(
      inArray(clients.status, ["live", "trial"]),
      eq(clients.reviewRequestsEnabled, true),
      isNull(clients.deletedAt),
    ),
  });
  // The plan gate, enforced where the texts are sent — not just on the switch.
  const onPro = await filterByFeature(enabled, "review_requests");
  if (enabled.length > onPro.length) logger.info("review_requests.plan_gated", { count: enabled.length - onPro.length });
  return mapLimit(onPro, 3, async (client) => {
    const base: ReviewRunResult = { clientId: client.id, clientName: client.name, sent: 0 };
    if (outOfBudget(deadline)) return { ...base, skipped: "time_budget" };
    return requestReviewsForClient(client, now);
  });
}
