import "server-only";
import type { Client } from "@/db/schema";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { notifier } from "@/lib/notifier";
import { isBlocked } from "@/lib/spam";
import { decideText } from "@/lib/texting-policy";
import { textLanguage } from "@/lib/appointment-messages";
import { getTextingPrefs } from "@/lib/data/texting-prefs";
import { isOptedOut } from "@/lib/data/sms-optouts";
import { getCustomerLanguage } from "@/lib/data/customer-languages";
import { getConsentedPhones, isConsented, type ConsentPurpose } from "@/lib/data/sms-consents";
import type { TextHistory } from "@/lib/data/revenue-texts";
import { inSendWindow, phoneKey, recipientSkipReason, type SkipReason } from "@/lib/revenue-texts";

/**
 * The one way a Pro revenue text leaves. Every feature builds its list of
 * people and its message; this decides who actually gets one and sends it.
 * Nothing here is feature-specific, so a rule added here covers all of them.
 */

export type ClientGate =
  | "deleted"
  | "suspended"
  | "not_active"
  | "trial_ended"
  | "payment_hold"
  | "texting_not_approved"
  | "outside_send_hours"
  | "texting_off"
  | "owner_quiet_hours";

/**
 * Business-level reasons not to send anything right now. Null = go.
 * Texting not approved (SMS_ENABLED isn't "on" until the A2P registration
 * clears) is a clean skip that gets logged, never an attempt that bounces.
 */
export async function revenueClientGate(client: Client, now = new Date()): Promise<ClientGate | null> {
  const flags = client.setupFlags ?? {};
  if (client.deletedAt) return "deleted";
  if (flags.suspended) return "suspended";
  if (client.status !== "live" && client.status !== "trial") return "not_active";
  if (flags.trialLapsedAt || flags.trialHoldAt) return "trial_ended";
  if (flags.stripeUnpaidAt) return "payment_hold";
  if (!env.SMS_ENABLED) return "texting_not_approved";
  if (!inSendWindow(now, client.timezone)) return "outside_send_hours";
  // The owner's own texting switch and quiet hours (Settings → Phone & AI).
  // Quiet hours would QUEUE the text inside the notifier, and a queued text
  // isn't in the history yet, so the next run could queue it again. Skip
  // instead; the next run inside their hours picks it up.
  const prefs = await getTextingPrefs(client.id);
  if (prefs) {
    const d = decideText(prefs, { now });
    if (d.action === "drop") return "texting_off";
    if (d.action === "queue") return "owner_quiet_hours";
  }
  return null;
}

export interface RevenueRecipient {
  phone: string;
  /** The exact text for this person, in their language. */
  body: (language: "en" | "es") => string;
  appointmentId?: string | null;
  leadId?: string | null;
  /** Called after each attempt that reached Twilio (sent, queued or failed). */
  onAttempt?: (res: { ok: boolean; queued?: boolean; error?: string; id?: string }) => Promise<void>;
}

export interface RevenueSendResult {
  sent: number;
  failed: number;
  queued: number;
  skipped: Partial<Record<SkipReason, number>>;
  /** Twilio isn't configured or the business can't text: stopped at the first try. */
  providerUnavailable: boolean;
  /** Stopped at `maxSends` with people left over. */
  capped: boolean;
}

export async function sendRevenueTexts(
  client: Client,
  opts: {
    kind: string;
    purpose: ConsentPurpose;
    recipients: RevenueRecipient[];
    history: TextHistory;
    spam: Set<string>;
    maxSends: number;
    now?: Date;
  },
): Promise<RevenueSendResult> {
  const now = opts.now ?? new Date();
  const out: RevenueSendResult = { sent: 0, failed: 0, queued: 0, skipped: {}, providerUnavailable: false, capped: false };
  if (opts.recipients.length === 0) return out;

  const consented = await getConsentedPhones(client.id, opts.purpose);
  const blocked = client.setupFlags?.blockedNumbers ?? [];
  const seen = new Set<string>();
  let attempts = 0;

  for (const r of opts.recipients) {
    const key = phoneKey(r.phone);
    // One text per person per run, however many rows point at them.
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);

    if (attempts >= opts.maxSends) {
      out.capped = true;
      break;
    }
    const reason = recipientSkipReason(
      {
        phone: r.phone,
        optedOut: key ? await isOptedOut(r.phone, client.id) : false,
        blocked: isBlocked(r.phone, blocked),
        spam: key ? opts.spam.has(key) : false,
        consented: isConsented(consented, r.phone),
        lastCappedTextAt: key ? (opts.history.lastCapped.get(key) ?? null) : null,
        sentTodayByClient: opts.history.sentLast24h,
      },
      now,
    );
    if (reason) {
      out.skipped[reason] = (out.skipped[reason] ?? 0) + 1;
      if (reason === "daily_cap") {
        out.capped = true;
        break;
      }
      continue;
    }

    const language = textLanguage(await getCustomerLanguage(client.id, r.phone));
    const body = r.body(language);
    attempts += 1;
    const res = await notifier.sendSms({
      to: r.phone.trim(),
      body,
      log: { clientId: client.id, kind: opts.kind, appointmentId: r.appointmentId ?? null, leadId: r.leadId ?? null },
    });
    if (res.skipped) {
      // Not configured, suspended or texting switched off: nothing was sent and
      // nothing will be this run. Logged, and the people stay eligible.
      out.providerUnavailable = true;
      logger.warn("revenue_texts.provider_unavailable", { clientId: client.id, kind: opts.kind, error: res.error });
      break;
    }
    if (key) opts.history.lastCapped.set(key, now);
    opts.history.sentLast24h += 1;
    await r.onAttempt?.(res);
    if (!res.ok) {
      out.failed += 1;
      logger.warn("revenue_texts.send_failed", { clientId: client.id, kind: opts.kind, error: res.error, code: res.code });
    } else if (res.queued) {
      out.queued += 1;
    } else {
      out.sent += 1;
    }
  }
  return out;
}
