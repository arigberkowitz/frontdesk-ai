import "server-only";
import { and, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { clients, type Client } from "@/db/schema";
import { mapLimit, outOfBudget } from "@/lib/agents/util";
import { getConsentedPhones, isConsented } from "@/lib/data/sms-consents";
import { isOptedOut } from "@/lib/data/sms-optouts";
import { getTextingPrefs } from "@/lib/data/texting-prefs";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { notifier } from "@/lib/notifier";
import { isBlocked } from "@/lib/spam";
import { inQuietHours } from "@/lib/texting-policy";
import {
  claimFollowup,
  finishFollowup,
  loadQuoteCandidates,
  sentInLastDay,
} from "./quote-followup-data";
import {
  MAX_PER_DAY,
  MAX_PER_RUN,
  dueStep,
  localHour,
  parseSettings,
  renderFollowup,
  stopReason,
  withinSendHours,
  type StopReason,
} from "./quote-followup";

export interface QuoteFollowupRunResult {
  clients: number;
  /** Switched on, but a business-level gate said no (no texting number, not approved, suspended…). */
  gated: number;
  /** Switched on, but outside 9am–7pm there (or the owner's quiet hours). */
  notDue: number;
  sent: number;
  failed: number;
  /** Someone was due a text but a stop rule applied. */
  stopped: Partial<Record<StopReason, number>>;
  skipped: number;
}

/**
 * Business-level reasons not to send anything for this business, or null.
 * These are the same gates every other customer text honors, checked up front
 * so a business that can't text never even loads its callers.
 */
export function businessGate(client: Client): string | null {
  const flags = client.setupFlags ?? {};
  if (client.deletedAt) return "deleted";
  if (flags.suspended) return "suspended";
  if (client.status !== "live" && client.status !== "trial") return "not_active";
  if (flags.trialLapsedAt || flags.trialHoldAt) return "trial_ended";
  if (flags.stripeUnpaidAt) return "payment_hold";
  if (!env.SMS_ENABLED) return "texting_not_approved";
  // These texts leave on the business's OWN number. The shared number is for
  // owner alerts: a STOP there would block every business.
  if (!client.smsNumber?.trim()) return "no_texting_number";
  return null;
}

/**
 * Hourly cron: for each business that switched this on, text the callers who
 * asked for a quote and never booked: step 1 a day after the call, step 2 a
 * week after it. Safe to re-run: every send is claimed in the ledger first.
 */
export async function sendQuoteFollowups(
  now: Date = new Date(),
  opts: { budgetMs?: number } = {},
): Promise<QuoteFollowupRunResult> {
  const deadline = Date.now() + (opts.budgetMs ?? 240_000);
  const active = await db.query.clients.findMany({
    where: and(
      inArray(clients.status, ["live", "trial"]),
      isNull(clients.deletedAt),
      sql`${clients.setupFlags}->'quoteFollowup'->>'enabled' = 'true'`,
    ),
  });
  const r: QuoteFollowupRunResult = { clients: active.length, gated: 0, notDue: 0, sent: 0, failed: 0, stopped: {}, skipped: 0 };
  const stop = (why: StopReason) => {
    r.stopped[why] = (r.stopped[why] ?? 0) + 1;
  };

  await mapLimit(active, 3, async (client) => {
    if (outOfBudget(deadline, 15_000)) {
      r.skipped++;
      return;
    }
    try {
      const settings = parseSettings(client.setupFlags);
      if (!settings.enabled) return;
      const gate = businessGate(client);
      if (gate) {
        r.gated++;
        logger.info("quote_followup.gated", { clientId: client.id, gate });
        return;
      }
      if (!withinSendHours(now, client.timezone)) {
        r.notDue++;
        return;
      }
      // The owner's texting controls: off means off, and quiet hours mean wait.
      const prefs = await getTextingPrefs(client.id);
      if (prefs && !prefs.textingEnabled) {
        r.gated++;
        return;
      }
      const hour = localHour(now, client.timezone);
      if (prefs && hour !== null && inQuietHours(hour, prefs.quietStartHour, prefs.quietEndHour)) {
        r.notDue++;
        return;
      }

      const candidates = await loadQuoteCandidates(client, now);
      if (!candidates || candidates.length === 0) return;

      let budget = Math.min(MAX_PER_RUN, MAX_PER_DAY - (await sentInLastDay(client.id, now)));
      if (budget <= 0) return;

      const consented = await getConsentedPhones(client.id, "lead_followup");
      const blocked = client.setupFlags?.blockedNumbers ?? [];

      for (const c of candidates) {
        if (budget <= 0) break;
        const step = dueStep({ callAt: c.callAt, now, step1SentAt: c.step1SentAt, step2SentAt: c.step2SentAt });
        if (!step) continue;
        const why = stopReason({
          phone: c.phone,
          ...c.facts,
          blocked: isBlocked(c.phone, blocked),
          optedOut: await isOptedOut(c.phone, client.id),
          consented: isConsented(consented, c.phone),
        });
        if (why) {
          stop(why);
          continue;
        }
        const claim = await claimFollowup({
          clientId: client.id,
          key: c.key,
          step,
          phone: c.phone,
          callId: c.callId,
          leadId: c.leadId,
          now,
        });
        if (!claim) continue; // already sent, in flight, or failed twice
        const body = renderFollowup({
          step,
          businessName: client.name,
          customerName: c.name,
          language: c.language,
          template: step === 1 ? settings.step1Template : settings.step2Template,
        });
        try {
          const res = await notifier.sendSms({
            to: c.phone,
            body,
            log: { clientId: client.id, kind: `quote_followup_${step}`, leadId: c.leadId },
          });
          if (res.skipped) {
            // Nothing was sent (Twilio off, company suspended). Release the claim.
            await finishFollowup(claim, { status: "skipped", body, language: c.language });
            r.skipped++;
          } else if (res.ok) {
            await finishFollowup(claim, { status: "sent", body, language: c.language, providerSid: res.id ?? null, at: now });
            r.sent++;
            budget--;
          } else {
            await finishFollowup(claim, { status: "failed", body, language: c.language, error: res.error ?? "Send failed" });
            r.failed++;
          }
        } catch (err) {
          await finishFollowup(claim, {
            status: "failed",
            body,
            language: c.language,
            error: err instanceof Error ? err.message : String(err),
          }).catch(() => undefined);
          r.failed++;
        }
      }
    } catch (err) {
      r.failed++;
      logger.error("quote_followup.client_failed", {
        clientId: client.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  logger.info("quote_followup.run", { ...r });
  return r;
}
