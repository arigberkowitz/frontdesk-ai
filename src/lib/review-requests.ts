/**
 * Who should be asked for a review, and what the text says.
 *
 * Pure and separate from the sending so the rules can be tested without a
 * database or a phone. The rules are the whole feature — a review request sent
 * to the wrong person, or twice, costs a small business the goodwill of a
 * customer it just served well.
 */

/** Hours after the visit ends before we ask. Long enough that they've left. */
export const REVIEW_DELAY_HOURS = 3;
/**
 * Past this, don't bother. Asking about a haircut from three weeks ago reads as
 * a mailing list, not a thank-you, and the answer is worse than no answer.
 */
export const REVIEW_MAX_AGE_HOURS = 72;
/** Nobody gets asked twice in this window, even across different visits. */
export const REVIEW_MIN_DAYS_BETWEEN = 90;

export interface ReviewCandidate {
  appointmentId: string;
  customerName: string | null;
  customerPhone: string | null;
  status: string;
  startAt: Date;
  endAt: Date | null;
  /** When this appointment was already asked about, if it was. */
  askedAt?: Date | null;
  /** The most recent review request sent to this phone number, any appointment. */
  lastAskedThisPhoneAt?: Date | null;
}

/**
 * Did the visit actually happen?
 *
 * There is no `completed` status on an appointment, and adding one would mean
 * asking a business to mark every visit done — which they will not do, so the
 * flag would be empty and the feature would never fire. The honest signal is
 * the one we already have: a booking that was not cancelled, was not a no-show,
 * and whose end time is in the past.
 */
export function visitHappened(c: ReviewCandidate, now: Date): boolean {
  if (c.status === "cancelled" || c.status === "no_show") return false;
  const ended = c.endAt ?? c.startAt;
  return ended.getTime() <= now.getTime();
}

export function shouldAskForReview(c: ReviewCandidate, now: Date): boolean {
  if (!c.customerPhone?.trim()) return false;
  if (!visitHappened(c, now)) return false;
  if (c.askedAt) return false;

  const ended = (c.endAt ?? c.startAt).getTime();
  const hoursSince = (now.getTime() - ended) / 3_600_000;
  if (hoursSince < REVIEW_DELAY_HOURS) return false;
  if (hoursSince > REVIEW_MAX_AGE_HOURS) return false;

  if (c.lastAskedThisPhoneAt) {
    const daysSince = (now.getTime() - c.lastAskedThisPhoneAt.getTime()) / 86_400_000;
    if (daysSince < REVIEW_MIN_DAYS_BETWEEN) return false;
  }
  return true;
}

/**
 * The message. Templated, never model-written — this leaves on the business's
 * own number, unattended, to a real customer.
 *
 * It thanks them before it asks, names the business so the text isn't from a
 * stranger, and carries the opt-out line every unattended message this product
 * sends is required to carry.
 */
export function reviewRequestBody(input: {
  businessName: string;
  customerName: string | null;
  reviewUrl: string;
}): string {
  const name = (input.customerName ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  const business = input.businessName.replace(/\s+/g, " ").trim().slice(0, 60);
  return (
    `Hi${name ? ` ${name}` : ""}, thanks for visiting ${business}! ` +
    `If we did right by you, a quick review really helps: ${input.reviewUrl}` +
    ` Reply STOP to opt out.`
  );
}
