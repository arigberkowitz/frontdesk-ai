/**
 * Social proof for the landing page — REAL entries only.
 *
 * Every item here is rendered as a factual claim to a prospective customer, so
 * nothing goes in without being true and approved:
 *
 * TODO(Ari): add testimonials only from real customers, with their written
 * permission to publish their name, business and words. Quote them verbatim.
 * While this list is empty the testimonials block doesn't render at all —
 * an empty or made-up quote is worse than none.
 */
export interface Testimonial {
  /** Their exact words. */
  quote: string;
  /** As they agreed to be named, e.g. "Maria G." */
  name: string;
  /** Business name (and city, if they agreed). */
  business: string;
  /** Must be true: you have written permission to publish this. */
  permissionConfirmed: true;
}

export const TESTIMONIALS: Testimonial[] = [];

/** Only entries with confirmed permission and non-empty text are shown. */
export function publishableTestimonials(list: readonly Testimonial[] = TESTIMONIALS): Testimonial[] {
  return list.filter(
    (t) => t.permissionConfirmed === true && t.quote.trim() && t.name.trim() && t.business.trim(),
  );
}
