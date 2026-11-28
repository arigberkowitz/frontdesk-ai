/**
 * The two extra "can we text you?" asks the AI can make on a call, each behind
 * its own owner switch (Settings → Follow-ups → "Ask callers about texts"),
 * both OFF by default. Same pattern as the quote ask (revenue/quote-consent.ts).
 *
 * Pure and client-safe: the settings card shows the exact question from here,
 * the prompt speaks it from here, and the receipt is stored under the wording
 * version from here, so the three can't drift.
 *
 *  - followup-v1: asked while booking, as its own question after the caller
 *    agrees to booking texts. The only consent
 *    that covers win-back, review-request and recall texts. Agreeing to booking
 *    texts (booking-v1/v2) is NOT enough for those: they're follow-up/marketing
 *    texts, not about the visit they just booked.
 *  - message-v1: asked when the AI takes a message from a caller who didn't
 *    book. Covers texts about that message (lead follow-up, an owner's typed
 *    reply) and the missed-call text-back if a later call drops.
 *
 * The tool endpoints re-check the owner's switch before recording a yes, so a
 * stale prompt can never create a consent the owner didn't ask for.
 */

export const FOLLOWUP_CONSENT_WORDING = "followup-v1";
export const MESSAGE_CONSENT_WORDING = "message-v1";

export const FOLLOWUP_CONSENT_QUESTION =
  "One more thing: is it okay if we also text you now and then, like asking how your visit went or letting you know when you're due again? It's no more than a couple of texts a month, message and data rates may apply, you can reply STOP at any time, and it's completely optional.";

export const FOLLOWUP_CONSENT_QUESTION_ES =
  "Una cosa más: ¿está bien si de vez en cuando también le enviamos mensajes de texto, por ejemplo para preguntarle cómo le fue o avisarle cuando le toque volver? No son más de un par de mensajes al mes, pueden aplicarse tarifas de mensajes y datos, puede responder STOP en cualquier momento y es completamente opcional.";

export const MESSAGE_CONSENT_QUESTION =
  "Is it okay if we text you at this number about your message, and if we ever miss your call? Message and data rates may apply, and you can reply STOP at any time.";

export const MESSAGE_CONSENT_QUESTION_ES =
  "¿Está bien si le enviamos un mensaje de texto a este número sobre su mensaje, y si alguna vez no podemos atender su llamada? Pueden aplicarse tarifas de mensajes y datos, y puede responder STOP en cualquier momento.";

export interface TextConsentAsks {
  /** Ask booked callers for follow-up texts (win-back, reviews, recall). */
  followup: boolean;
  /** Ask callers who leave a message whether we can text them about it. */
  message: boolean;
}

export function parseTextConsentAsks(flags: unknown): TextConsentAsks {
  const raw = (flags as { textConsentAsks?: unknown } | null | undefined)?.textConsentAsks;
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return { followup: r.followup === true, message: r.message === true };
}

function versioned(base: string, language: string | null | undefined): string {
  const code = String(language ?? "").trim().toLowerCase().slice(0, 5);
  return code && code !== "en" && /^[a-z]{2}(-[a-z]{2})?$/.test(code) ? `${base}-${code}` : base;
}

export const followupConsentWordingFor = (language?: string | null) => versioned(FOLLOWUP_CONSENT_WORDING, language);
export const messageConsentWordingFor = (language?: string | null) => versioned(MESSAGE_CONSENT_WORDING, language);

/** The prompt rule for the follow-up ask (after a booking). */
export function followupConsentPromptRule(opts: { spanish: boolean }): string {
  return [
    "Follow-up texts: when a caller is booking and has clearly said yes to the booking texts, ask one more separate, optional question before you call book_appointment, exactly:",
    `"${FOLLOWUP_CONSENT_QUESTION}"`,
    opts.spanish ? `In Spanish, ask exactly: "${FOLLOWUP_CONSENT_QUESTION_ES}"` : "",
    "In any other language, translate it faithfully and keep the word STOP in English.",
    "Only a clear yes counts. If they say no or hesitate, say that's fine and move on; never ask twice or push. Their booking is the same either way.",
    "Never ask it if they said no to the booking texts. Pass followup_text_consent as true on book_appointment only if they clearly said yes; otherwise false.",
  ]
    .filter(Boolean)
    .join(" ");
}

/** The prompt rule for the message ask (callers who don't book). */
export function messageConsentPromptRule(opts: { spanish: boolean; quoteAskOn: boolean }): string {
  return [
    "Text consent for messages: when you take a message (take_message) from a caller who did NOT book, after reading back their number, ask once, exactly:",
    `"${MESSAGE_CONSENT_QUESTION}"`,
    opts.spanish ? `In Spanish, ask exactly: "${MESSAGE_CONSENT_QUESTION_ES}"` : "",
    "In any other language, translate it faithfully and keep the word STOP in English.",
    opts.quoteAskOn ? "If you already asked the quote-text question on this call, don't ask this one too." : "",
    "Only a clear yes counts. If they say no or hesitate, say you won't text them and move on; never ask twice or push.",
    "Pass message_text_consent as true only if they clearly said yes, false otherwise.",
  ]
    .filter(Boolean)
    .join(" ");
}
