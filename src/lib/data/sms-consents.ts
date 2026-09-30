import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { smsConsents } from "@/db/schema";
import { logger } from "./../logger";
import { normalizePhone } from "./sms-optouts";

/**
 * The exact consent script version currently in force. This string is the
 * contract between three places that must not drift: the prompt rule that
 * makes the agent ask (src/lib/prompt.ts), the published description on
 * /sms-consent, and the A2P campaign registered with the carriers. Bump it if
 * the ask ever changes, so old rows keep saying what was actually agreed to.
 */
export const CONSENT_WORDING_VERSION = "booking-v1";

/**
 * Write the receipt for a "yes, text me".
 *
 * Best-effort by design: the booking has already succeeded and the caller is
 * being told so — a logging hiccup here must not unwind any of that. A missed
 * receipt is strictly better than a failed booking, and the call recording
 * still exists as the deeper proof.
 */
export async function recordSmsConsent(input: {
  clientId: string;
  phone: string;
  callId?: string | null;
}): Promise<void> {
  try {
    await db.insert(smsConsents).values({
      clientId: input.clientId,
      phone: input.phone,
      callId: input.callId ?? null,
      wording: CONSENT_WORDING_VERSION,
    });
  } catch (err) {
    logger.error("sms_consent.record_failed", {
      clientId: input.clientId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Automated or follow-up texts that must be backed by a stored consent row.
 * (Booking confirmations are sent on the in-call "yes" itself and reminders
 * inherit from a delivered confirmation — see appointment-texts.ts.)
 */
export type ConsentPurpose =
  | "recall"
  | "review_request"
  | "recovery_lead"
  | "recovery_no_show"
  | "lead_followup"
  /**
   * An owner's typed text from portal → Messages to a customer who has NOT
   * texted the business yet (the thread is only automated texts). A reply to
   * a customer who texted in is conversational and isn't gated on this — see
   * DECISIONS.md "Messages: reply by text".
   */
  | "portal_reply";

/**
 * Which recorded consent wordings cover which kind of text.
 *
 * TODO(Ari): this is a policy decision, not a code one. Today the only script
 * is "booking-v1" ("text you the confirmation and a reminder"), and it is
 * mapped to every purpose so these features keep working for customers who
 * did agree to texts. The published /sms-consent policy says no marketing
 * texts; if recall and review requests are judged promotional, remove
 * "booking-v1" from those two lists (they'll then send to nobody) until a
 * separate consent script and campaign use case exist.
 */
export const CONSENT_COVERAGE: Record<ConsentPurpose, readonly string[]> = {
  recall: [CONSENT_WORDING_VERSION],
  review_request: [CONSENT_WORDING_VERSION],
  recovery_lead: [CONSENT_WORDING_VERSION],
  recovery_no_show: [CONSENT_WORDING_VERSION],
  lead_followup: [CONSENT_WORDING_VERSION],
  portal_reply: [CONSENT_WORDING_VERSION],
};

/** Pure: the set of numbers (normalized digits) whose consent rows cover `purpose`. */
export function coveredPhones(
  rows: readonly { phone: string; wording: string }[],
  purpose: ConsentPurpose,
): Set<string> {
  const ok = new Set(CONSENT_COVERAGE[purpose]);
  const out = new Set<string>();
  for (const r of rows) {
    const key = normalizePhone(r.phone ?? "");
    if (key && ok.has(r.wording)) out.add(key);
  }
  return out;
}

/**
 * Numbers that agreed to texts from THIS business, under a wording that covers
 * `purpose`. Fails SAFE: if the lookup errors, nobody is consented, so nothing
 * is sent — the same stance isOptedOut takes.
 */
export async function getConsentedPhones(clientId: string, purpose: ConsentPurpose): Promise<Set<string>> {
  const wordings = [...CONSENT_COVERAGE[purpose]];
  if (wordings.length === 0) return new Set();
  try {
    const rows = await db
      .select({ phone: smsConsents.phone, wording: smsConsents.wording })
      .from(smsConsents)
      .where(and(eq(smsConsents.clientId, clientId), inArray(smsConsents.wording, wordings)));
    return coveredPhones(rows, purpose);
  } catch (err) {
    logger.error("sms_consent.lookup_failed", {
      clientId,
      error: err instanceof Error ? err.message : String(err),
    });
    return new Set();
  }
}

/** True when `phone` is in a set returned by getConsentedPhones. */
export function isConsented(consented: Set<string>, phone: string | null | undefined): boolean {
  const key = normalizePhone(phone ?? "");
  return Boolean(key) && consented.has(key);
}

/** Single-number convenience for one-off sends (e.g. an owner's follow-up text). */
export async function hasSmsConsent(
  clientId: string,
  phone: string | null | undefined,
  purpose: ConsentPurpose,
): Promise<boolean> {
  if (!normalizePhone(phone ?? "")) return false;
  return isConsented(await getConsentedPhones(clientId, purpose), phone);
}
