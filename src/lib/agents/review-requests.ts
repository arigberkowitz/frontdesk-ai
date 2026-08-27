import "server-only";
import { and, desc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { agentRuns, appointments, clients, reminders, type Client } from "@/db/schema";
import { createReminder } from "@/lib/data/reminders";
import { isOptedOut } from "@/lib/data/sms-optouts";
import { isDeliverableUrl } from "@/lib/webhooks-out";
import {
  REVIEW_DELAY_HOURS,
  REVIEW_MAX_AGE_HOURS,
  reviewRequestBody,
  shouldAskForReview,
  type ReviewCandidate,
} from "@/lib/review-requests";
import { notifier } from "@/lib/notifier";
import { logger } from "@/lib/logger";
import { mapLimit, outOfBudget } from "./util";

/**
 * Ask the customers we just served to say so publicly.
 *
 * For a local service business, search reviews decide who gets called at all,
 * and the moment to ask is a few hours after a good visit — not in a monthly
 * campaign. Everything needed was already here: we know the appointment
 * happened, we have the number, and we already send texts.
 *
 * Every guardrail from the recovery loop applies, for the same reasons:
 *  - OPT-IN per client, and useless without a review URL they chose
 *  - one ask per appointment, and never twice to the same number within 90 days
 *  - local daytime only, per-client daily cap
 *  - templated body, never model-written — this goes out unattended
 *  - STOP is checked before every send and printed in every message
 *  - a provider that isn't configured burns nothing: no row, still eligible
 */

const MAX_SENDS_PER_CLIENT = 25;

function localHour(tz: string | null): number {
  try {
    return Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: tz ?? "America/Los_Angeles",
        hour: "numeric",
        hour12: false,
      }).format(new Date()),
    );
  } catch {
    return 12;
  }
}

export interface ReviewRunResult {
  clientId: string;
  clientName: string;
  sent: number;
  skipped?: string;
}

export async function requestReviewsForClient(
  client: Client,
  now = new Date(),
): Promise<ReviewRunResult> {
  const base: ReviewRunResult = { clientId: client.id, clientName: client.name, sent: 0 };

  const reviewUrl = client.reviewUrl?.trim();
  if (!reviewUrl) return { ...base, skipped: "no_review_url" };
  // The same fence the outbound webhooks use. This URL is typed by a customer
  // and then texted to THEIR customers; an http link in a text from a business
  // is a phishing lesson nobody needs.
  if (!isDeliverableUrl(reviewUrl)) return { ...base, skipped: "review_url_not_allowed" };

  const hour = localHour(client.timezone);
  if (hour < 9 || hour >= 19) return { ...base, skipped: "outside_daytime" };

  // The window: ended long enough ago to ask, recently enough to be welcome.
  const newest = new Date(now.getTime() - REVIEW_DELAY_HOURS * 3_600_000);
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

  // One query for the whole ask-history of these appointments, plus every
  // review request this client has ever sent, so the 90-day rule can be
  // answered per phone number without a query each.
  const asked = await db.query.reminders.findMany({
    where: and(
      eq(reminders.clientId, client.id),
      eq(reminders.kind, "review_request"),
      inArray(reminders.status, ["queued", "sent"]),
    ),
    orderBy: [desc(reminders.createdAt)],
    limit: 1000,
  });
  const askedAppointment = new Set(asked.map((r) => r.appointmentId).filter(Boolean));
  // Map an appointment id back to the number it went to, so "this phone was
  // asked recently" can be resolved from the same rows.
  const apptById = new Map(recent.map((a) => [a.id, a]));
  const lastAskByPhone = new Map<string, Date>();
  for (const r of asked) {
    const phone = r.appointmentId ? apptById.get(r.appointmentId)?.customerPhone : null;
    if (!phone) continue;
    const key = phone.replace(/\D/g, "").slice(-10);
    if (!lastAskByPhone.has(key)) lastAskByPhone.set(key, r.createdAt);
  }

  const due = recent.filter((a) => {
    const key = (a.customerPhone ?? "").replace(/\D/g, "").slice(-10);
    const candidate: ReviewCandidate = {
      appointmentId: a.id,
      customerName: a.customerName,
      customerPhone: a.customerPhone,
      status: a.status,
      startAt: a.startAt,
      endAt: a.endAt,
      askedAt: askedAppointment.has(a.id) ? new Date(0) : null,
      lastAskedThisPhoneAt: lastAskByPhone.get(key) ?? null,
    };
    return shouldAskForReview(candidate, now);
  });
  if (due.length === 0) return { ...base, skipped: "nothing_due" };

  const [run] = await db
    .insert(agentRuns)
    .values({ clientId: client.id, kind: "review_request" })
    .returning();

  let sent = 0;
  let notSent = 0;
  try {
    for (const appt of due.slice(0, MAX_SENDS_PER_CLIENT)) {
      const to = appt.customerPhone!.trim();
      if (await isOptedOut(to)) continue;
      const body = reviewRequestBody({
        businessName: client.name,
        customerName: appt.customerName,
        reviewUrl,
      });
      const result = await notifier.sendSms({ to, body });
      if (result.skipped) {
        notSent += 1;
        continue;
      }
      const failed = !result.ok;
      await createReminder(client.id, {
        appointmentId: appt.id,
        leadId: null,
        channel: "sms",
        kind: "review_request",
        status: failed ? "failed" : "sent",
        sentAt: failed ? null : new Date(),
        error: failed ? (result.error ?? "Send failed") : null,
      });
      if (!failed) sent += 1;
    }
    if (run) {
      await db
        .update(agentRuns)
        .set({
          status: "succeeded",
          finishedAt: new Date(),
          stats: { attempted: due.length, sent, notSent, feature: "review_requests" },
        })
        .where(eq(agentRuns.id, run.id));
    }
    if (notSent > 0) {
      logger.warn("agents.reviews.provider_unavailable", { clientId: client.id, notSent });
    }
    return { ...base, sent, ...(notSent > 0 && sent === 0 ? { skipped: "sms_not_configured" } : {}) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (run) {
      await db
        .update(agentRuns)
        .set({ status: "failed", finishedAt: new Date(), error: message })
        .where(eq(agentRuns.id, run.id));
    }
    logger.error("agents.reviews.failed", { clientId: client.id, error: message });
    return { ...base, sent, skipped: `error: ${message}` };
  }
}

/** Daily entry point: every live client that turned this on. */
export async function runReviewRequests(budgetMs = 240_000): Promise<ReviewRunResult[]> {
  const deadline = Date.now() + budgetMs;
  const active = await db.query.clients.findMany({
    where: and(
      eq(clients.status, "live"),
      eq(clients.reviewRequestsEnabled, true),
      isNull(clients.deletedAt),
    ),
  });
  return mapLimit(active, 3, async (client) => {
    const base: ReviewRunResult = { clientId: client.id, clientName: client.name, sent: 0 };
    if (outOfBudget(deadline)) return { ...base, skipped: "time_budget" };
    return requestReviewsForClient(client);
  });
}
