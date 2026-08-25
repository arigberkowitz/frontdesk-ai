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
 * Set SUPPORT_EMAIL in the environment the moment support@frontdeskai.company
 * actually receives mail. The default stays on the working inbox on purpose —
 * an address that bounces is strictly worse than an unglamorous one, so this
 * flips over only when there is somewhere real for it to land.
 */
export const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL ?? "arigberkowitz@gmail.com";

/** `mailto:` href for {@link SUPPORT_EMAIL}, optionally with a subject. */
export function supportMailto(subject?: string): string {
  return subject
    ? `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`
    : `mailto:${SUPPORT_EMAIL}`;
}
