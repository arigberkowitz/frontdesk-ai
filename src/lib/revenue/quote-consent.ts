/**
 * "Can we text you about your quote?" — the owner-controlled ask the AI makes
 * to callers who asked for a price and didn't book.
 *
 * Pure and client-safe: the settings card shows the exact question from here,
 * the prompt speaks it from here, and the receipt is stored under the wording
 * version from here, so the three can't drift.
 *
 * The agent only asks when ALL of these hold:
 *  - the business is on Pro (plan feature "quote_followup")
 *  - the owner turned quote follow-up on
 *  - the owner turned this ask on (separate switch, default OFF)
 * The tool endpoint re-checks the same three before it records a yes, so a
 * stale prompt can never create a consent the owner didn't ask for.
 */

/** Stored on the sms_consents row. Bump it if the question ever changes. */
export const QUOTE_CONSENT_WORDING = "quote-v1";

/** The exact question, English. */
export const QUOTE_CONSENT_QUESTION =
  "Is it okay if we text you at this number to follow up on your quote? It's at most two texts, message and data rates may apply, and you can reply STOP at any time to opt out.";

/** The exact question, Spanish. */
export const QUOTE_CONSENT_QUESTION_ES =
  "¿Está bien si le enviamos un mensaje de texto a este número para dar seguimiento a su cotización? Son como máximo dos mensajes, pueden aplicarse tarifas de mensajes y datos, y puede responder STOP en cualquier momento para dejar de recibirlos.";

/** "quote-v1", or "quote-v1-es" etc. when the ask was made in another language. */
export function quoteConsentWordingFor(language: string | null | undefined): string {
  const code = String(language ?? "").trim().toLowerCase().slice(0, 5);
  return code && code !== "en" && /^[a-z]{2}(-[a-z]{2})?$/.test(code)
    ? `${QUOTE_CONSENT_WORDING}-${code}`
    : QUOTE_CONSENT_WORDING;
}

/** Whether a stored wording is one of ours (any language). */
export function isQuoteConsentWording(wording: string): boolean {
  return wording === QUOTE_CONSENT_WORDING || wording.startsWith(`${QUOTE_CONSENT_WORDING}-`);
}

/** All three switches. `planAllows` is the server's plan check ("quote_followup"). */
export function quoteConsentAskOn(input: {
  planAllows: boolean;
  settings: { enabled: boolean; askConsent?: boolean };
}): boolean {
  return input.planAllows && input.settings.enabled && input.settings.askConsent === true;
}

/** The prompt rule, or null when the ask is off. */
export function quoteConsentPromptRule(opts: { spanish: boolean }): string {
  return [
    "Price and quote callers: if a caller asks what something costs, or for a quote or estimate, and does NOT book on this call, ask once, near the end, whether you may text them about it.",
    "First ask for the best mobile number (read it back). Then ask, as its own question, exactly:",
    `"${QUOTE_CONSENT_QUESTION}"`,
    opts.spanish ? `In Spanish, ask exactly: "${QUOTE_CONSENT_QUESTION_ES}"` : "",
    "In any other language, translate it faithfully and keep the word STOP in English.",
    "Only a clear yes counts. If they say no or hesitate, say you won't text them and move on; never ask twice or push.",
    "Never ask a caller who booked (the booking question already covers their texts).",
    "Then use take_message as usual and pass text_consent as true only if they clearly said yes, false otherwise.",
  ]
    .filter(Boolean)
    .join(" ");
}
