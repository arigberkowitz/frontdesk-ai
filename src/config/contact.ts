/**
 * The one address a customer is told to write to.
 *
 * This used to be a personal Gmail typed out in six separate files — the
 * support card, the contact page, the terms, the privacy policy, and two
 * action modules. Six copies is six edits and at least one miss, and the
 * address itself is the problem: a business being asked for $300 a month
 * writes to a stranger's gmail.com and quietly decides this is somebody's
 * weekend project.
 *
 * support@frontdeskai.company forwards (Forward Email MX on the domain), so
 * it is the public default. SUPPORT_EMAIL overrides it.
 */
export const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || "support@frontdeskai.company";

/** `mailto:` href for {@link SUPPORT_EMAIL}, optionally with a subject. */
export function supportMailto(subject?: string): string {
  return subject
    ? `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`
    : `mailto:${SUPPORT_EMAIL}`;
}
