/**
 * Honest copy about texting while it isn't switched on yet.
 *
 * Every text this product sends waits on carrier approval of our messaging
 * registration (A2P 10DLC). Until SMS_ENABLED is on, nothing is texted:
 * owners get alerts by email and app notification, callers get no texts. The
 * site used to promise texts regardless. Pages pass `env.SMS_ENABLED` in, so
 * this copy flips by itself the day texting goes live, without lying either way.
 *
 * Pure and client-safe.
 */

export const TEXTING_PENDING_NOTE =
  "Texts turn on once your number is approved by carriers. Until then, alerts come by email and app notification.";

/** Short form for a footnote marker. */
export const TEXTING_PENDING_SHORT = "Texts turn on once your number is approved by carriers.";

/** A plan bullet or sentence that promises texting. */
export function mentionsTexts(s: string): boolean {
  return /\btext(s|ed|ing)?\b/i.test(s);
}

/** "texts or emails you" while texting is live; email first while it isn't. */
export function leadAlertPhrase(live: boolean): string {
  return live ? "texts or emails you" : "emails you (and texts you, once carriers approve texting)";
}
