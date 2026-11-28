import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { smsConsents } from "@/db/schema";
import { logger } from "./../logger";
import { normalizePhone } from "./sms-optouts";
import { LANGUAGE_OPTIONS, normalizeCustomerLanguage } from "@/lib/languages";
import { QUOTE_CONSENT_WORDING } from "@/lib/revenue/quote-consent";
import { FOLLOWUP_CONSENT_WORDING, MESSAGE_CONSENT_WORDING } from "@/lib/text-consent-asks";

/**
 * The exact consent script version currently in force. This string is the
 * contract between three places that must not drift: the prompt rule that
 * makes the agent ask (src/lib/prompt.ts), the published description on
 * /sms-consent, and the A2P campaign registered with the carriers. Bump it if
 * the ask ever changes, so old rows keep saying what was actually agreed to.
 */
export const CONSENT_WORDING_VERSION = "booking-v2";

/**
 * Older scripts still on file. booking-v1 asked for "the confirmation and a
 * reminder"; booking-v2 adds "and a quick follow-up about this visit" so the
 * review request and reschedule texts are covered by what the caller heard.
 */
const PREVIOUS_WORDING_VERSIONS = ["booking-v1"] as const;

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
const BOOKING_V1_WORDINGS: readonly string[] = [CONSENT_WORDING_VERSION, ...PREVIOUS_WORDING_VERSIONS].flatMap((v) => [
  v,
  ...LANGUAGE_OPTIONS.filter((l) => l.code !== "en").map((l) => `${v}-${l.code}`),
]);

/** quote-v1 and its translations (quote-consent.ts). */
const QUOTE_V1_WORDINGS: readonly string[] = [
  QUOTE_CONSENT_WORDING,
  ...LANGUAGE_OPTIONS.filter((l) => l.code !== "en").map((l) => `${QUOTE_CONSENT_WORDING}-${l.code}`),
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
  /** A different script than the booking ask (e.g. quote-consent.ts), already versioned. */
  wording?: string;
}): Promise<void> {
  try {
    await db.insert(smsConsents).values({
      clientId: input.clientId,
      phone: input.phone,
      callId: input.callId ?? null,
      wording: input.wording ?? consentWordingFor(input.language),
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
   * Quote follow-up (Pro): the day-1 and day-7 texts to a caller who asked for
   * a price and didn't book. Covered by the booking ask, and by the separate
   * "can we text you about your quote?" ask (quote-v1) when the owner turns
   * that on. quote-v1 covers ONLY this purpose.
   */
  | "quote_followup"
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
  | "rebook"
  /**
   * Pro win-back: "it's been a while — want to book?" to a past customer.
   * Needs the follow-up consent (followup-v1); see src/lib/agents/winback.ts.
   */
  | "winback";

/** followup-v1 and message-v1 and their translations (text-consent-asks.ts). */
const translations = (base: string): string[] => [
  base,
  ...LANGUAGE_OPTIONS.filter((l) => l.code !== "en").map((l) => `${base}-${l.code}`),
];
const FOLLOWUP_V1_WORDINGS: readonly string[] = translations(FOLLOWUP_CONSENT_WORDING);
const MESSAGE_V1_WORDINGS: readonly string[] = translations(MESSAGE_CONSENT_WORDING);

/**
 * Which recorded consent wordings cover which kind of text.
 *
 * Decided by Ari (Nov 2026): consent is scoped.
 *  - Booking consent (booking-v1/v2: "the confirmation, a reminder, and a quick
 *    follow-up about this visit") covers texts about THAT booking and the
 *    caller's own enquiry: reschedules, no-show recovery, lead and quote
 *    follow-up, an owner's reply, the missed-call text-back.
 *  - Win-back, review-request and recall texts are follow-up/marketing texts.
 *    They need the separate, optional follow-up yes (followup-v1), asked by the
 *    AI only when the owner turns it on. A booking-only consent is NOT enough,
 *    so with the ask off these send to nobody. /sms-consent and the privacy
 *    policy describe exactly this.
 *  - message-v1 (asked when taking a message) covers texts about that message
 *    and a later missed-call text-back, never marketing.
 *  - quote-v1 covers only the quote follow-up.
 * Whether a missed caller who agreed to NOTHING may be texted once is a legal
 * call for Ari/counsel (DECISIONS.md "Missed-call text-back"); until then they
 * aren't.
 */
export const CONSENT_COVERAGE: Record<ConsentPurpose, readonly string[]> = {
  recall: FOLLOWUP_V1_WORDINGS,
  review_request: FOLLOWUP_V1_WORDINGS,
  winback: FOLLOWUP_V1_WORDINGS,
  recovery_lead: [...BOOKING_V1_WORDINGS, ...MESSAGE_V1_WORDINGS],
  recovery_no_show: BOOKING_V1_WORDINGS,
  lead_followup: [...BOOKING_V1_WORDINGS, ...MESSAGE_V1_WORDINGS],
  quote_followup: [...BOOKING_V1_WORDINGS, ...QUOTE_V1_WORDINGS],
  portal_reply: [...BOOKING_V1_WORDINGS, ...MESSAGE_V1_WORDINGS],
  missed_call: [...BOOKING_V1_WORDINGS, ...MESSAGE_V1_WORDINGS],
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

/**
 * How many numbers have agreed to each kind of text, for the owner's settings
 * card. "followup" is who win-back, review and recall texts can reach.
 */
export async function countConsentsByScope(
  clientId: string,
): Promise<{ booking: number; followup: number; textBack: number }> {
  const scopes = { booking: "rebook", followup: "winback", textBack: "missed_call" } as const;
  const out = { booking: 0, followup: 0, textBack: 0 };
  for (const [k, purpose] of Object.entries(scopes) as [keyof typeof out, ConsentPurpose][]) {
    out[k] = (await getConsentedPhones(clientId, purpose)).size;
  }
  return out;
}
