import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { smsConsents } from "@/db/schema";
import { logger } from "./../logger";
import { normalizePhone } from "./sms-optouts";
import { LANGUAGE_OPTIONS, normalizeCustomerLanguage } from "@/lib/languages";

/**
 * The exact consent script version currently in force. This string is the
 * contract between three places that must not drift: the prompt rule that
 * makes the agent ask (src/lib/prompt.ts), the published description on
 * /sms-consent, and the A2P campaign registered with the carriers. Bump it if
 * the ask ever changes, so old rows keep saying what was actually agreed to.
 */
export const CONSENT_WORDING_VERSION = "booking-v1";

/**
 * The same ask, made in the caller's language (multilingual answering):
 * "booking-v1-es" etc. The receipt says which language the yes was given in.
 * The Spanish wording is fixed in the prompt (lib/languages.ts
 * SPANISH_CONSENT_ASK); other languages are the agent's faithful translation.
 */
export function consentWordingFor(language: string | null | undefined): string {
  const code = normalizeCustomerLanguage(language);
  return code && code !== "en" ? `${CONSENT_WORDING_VERSION}-${code}` : CONSENT_WORDING_VERSION;
}

/** booking-v1 and its translations: one consent, asked in different languages. */
const BOOKING_V1_WORDINGS: readonly string[] = [
  CONSENT_WORDING_VERSION,
  ...LANGUAGE_OPTIONS.filter((l) => l.code !== "en").map((l) => `${CONSENT_WORDING_VERSION}-${l.code}`),
];

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
  /** The language the ask was made in, when not English. */
  language?: string | null;
}): Promise<void> {
  try {
    await db.insert(smsConsents).values({
      clientId: input.clientId,
      phone: input.phone,
      callId: input.callId ?? null,
      wording: consentWordingFor(input.language),
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
  | "portal_reply"
  /**
   * The one templated "sorry we missed you — reply to book" text after a call
   * that ended early or dropped without a booking. See DECISIONS.md
   * "Missed-call text-back".
   */
  | "missed_call"
  /**
   * Smart rebooking: "we have to move your appointment — reply 1, 2 or 3",
   * sent only when the owner confirms in the portal. Also allowed when the
   * customer already received this appointment's confirmation text (the same
   * inheritance the day-before reminder uses) — see src/lib/rebooking.ts.
   */
  | "rebook";

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
  recall: BOOKING_V1_WORDINGS,
  review_request: BOOKING_V1_WORDINGS,
  recovery_lead: BOOKING_V1_WORDINGS,
  recovery_no_show: BOOKING_V1_WORDINGS,
  lead_followup: BOOKING_V1_WORDINGS,
  portal_reply: BOOKING_V1_WORDINGS,
  // TODO(Ari): same policy call as above. booking-v1 covers it so a returning
  // customer who agreed to texts can be texted back after a dropped call. A
  // first-time caller who hung up early has usually agreed to nothing, so they
  // will NOT be texted until a consent wording covers this purpose (or counsel
  // decides a one-off reply to their own call needs none — then this gate in
  // src/lib/agents/missed-call-callback.ts is the single place to change).
  missed_call: BOOKING_V1_WORDINGS,
  // A text about an appointment they booked and agreed to texts about —
  // squarely what booking-v1 ("confirmation and a reminder") describes.
  rebook: BOOKING_V1_WORDINGS,
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
