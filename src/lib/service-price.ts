/** Service price parsing: a single price, a range, or "starts at". */

/** A range needs a bottom, and its top must be above it. */
export function priceRangeError(d: { priceDollars?: number; priceMaxDollars?: number }): string | null {
  if (d.priceMaxDollars == null) return null;
  if (d.priceDollars == null) return "Add the starting price too.";
  if (d.priceMaxDollars <= d.priceDollars) return "The top of the range must be more than the price.";
  return null;
}

export function priceFields(d: { priceDollars?: number; priceMaxDollars?: number; priceFrom?: boolean }) {
  const priceCents = d.priceDollars != null ? Math.round(d.priceDollars * 100) : null;
  const priceMaxCents =
    priceCents != null && d.priceMaxDollars != null ? Math.round(d.priceMaxDollars * 100) : null;
  return {
    priceCents,
    priceMaxCents,
    // A range already says "estimate"; "starts at" only applies to a single price.
    priceFrom: priceCents != null && priceMaxCents == null && d.priceFrom === true,
  };
}

