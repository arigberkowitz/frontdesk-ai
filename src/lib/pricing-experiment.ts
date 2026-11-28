/**
 * Pure assignment and copy for the pricing-section A/B test.
 *
 * Kept free of Next and the Flags SDK so tests can pin the split, the copy,
 * and the visitor ids used for screenshots without spinning up a request.
 */
export const HEADLINE_VARIANTS = ["control", "variant"] as const;
export type HeadlineVariant = (typeof HEADLINE_VARIANTS)[number];

/** Control keeps Pro highlighted, the way the page works today. */
export const HIGHLIGHT_VARIANTS = ["pro", "starter"] as const;
export type HighlightVariant = (typeof HIGHLIGHT_VARIANTS)[number];

export const PRICING_HEADLINE_KEY = "pricing-headline";
export const PRICING_HIGHLIGHT_KEY = "pricing-highlight";

/**
 * Current headline and the one alternative we are testing.
 *
 * Variant copy follows the house rules: plain words, the real prices, and
 * "one flat monthly price". Prices and plan features stay $199 / $399 / $599
 * and are not changed by the experiment.
 *
 * The subhead is the sentence before the optional tax clause and the
 * "Questions?" link, which stay the same on both variants.
 */
export const PRICING_HEADLINE_COPY: Record<
  HeadlineVariant,
  { title: string; sub: string }
> = {
  control: {
    // Both arms say "One flat monthly price" (Ari, Nov 2026); the test now
    // compares only the subhead: "one price per location" vs the real prices.
    title: "One flat monthly price",
    sub: "Two weeks free, no card. One price per location after that, and no setup fee — ever",
  },
  variant: {
    title: "One flat monthly price",
    sub: "Two weeks free, no card. Then $199, $399, or $599 a month per location, and no setup fee — ever",
  },
};

/**
 * A small, well-mixing 32-bit string hash (cyrb53, low word). Stable in Node
 * and the Edge runtime, no extra dependency. The flag key is the seed so two
 * flags on the same visitor are independent.
 */
export function hash32(input: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return h1 >>> 0;
}

function seedFromKey(flagKey: string): number {
  const n = hash32(flagKey);
  return n === 0 ? 1 : n;
}

export function assignBucket<T extends string>(
  visitorId: string,
  flagKey: string,
  options: readonly T[],
): T {
  if (options.length === 0) {
    throw new Error("assignBucket needs at least one option");
  }
  return options[hash32(visitorId, seedFromKey(flagKey)) % options.length]!;
}

export function assignPricingVariants(visitorId: string): {
  headline: HeadlineVariant;
  highlight: HighlightVariant;
} {
  return {
    headline: assignBucket(visitorId, PRICING_HEADLINE_KEY, HEADLINE_VARIANTS),
    highlight: assignBucket(visitorId, PRICING_HIGHLIGHT_KEY, HIGHLIGHT_VARIANTS),
  };
}

/**
 * Find a visitor id that evaluates to the requested combination. Used by
 * tests and the screenshot script so we can review each variant without
 * Flags Explorer (which needs FLAGS_SECRET).
 */
export function visitorIdFor(
  target: { headline?: HeadlineVariant; highlight?: HighlightVariant },
  prefix = "shot",
): string {
  for (let i = 0; i < 50_000; i++) {
    const id = `${prefix}-${String(i).padStart(6, "0")}`;
    const got = assignPricingVariants(id);
    if (target.headline && got.headline !== target.headline) continue;
    if (target.highlight && got.highlight !== target.highlight) continue;
    return id;
  }
  throw new Error("Could not find a visitor id for the requested variants");
}
