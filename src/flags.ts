import { dedupe, flag } from "flags/next";
import type { ReadonlyRequestCookies } from "flags";
import {
  assignBucket,
  HEADLINE_VARIANTS,
  HIGHLIGHT_VARIANTS,
  PRICING_HEADLINE_COPY,
  PRICING_HEADLINE_KEY,
  PRICING_HIGHLIGHT_KEY,
  type HeadlineVariant,
  type HighlightVariant,
} from "@/lib/pricing-experiment";
import { isUsableVisitorId, VISITOR_COOKIE } from "@/lib/visitor-id";

type Entities = { visitor?: { id: string } };

/**
 * Identify the anonymous visitor from the cookie set in `src/proxy.ts`.
 * Wrapped in `dedupe` so both flags on a request share one cookie read.
 */
const identify = dedupe(({ cookies }: { cookies: ReadonlyRequestCookies }): Entities => {
  const id = cookies.get(VISITOR_COOKIE)?.value;
  return { visitor: isUsableVisitorId(id) ? { id } : undefined };
});

/**
 * Pricing section headline on the marketing landing page.
 *
 * 50/50 by visitor id. No visitor cookie (first paint before proxy, a
 * blocked cookie, or a request with no id) returns control so the live site
 * never depends on FLAGS_SECRET or any other env var.
 */
export const pricingHeadlineFlag = flag<HeadlineVariant, Entities>({
  key: PRICING_HEADLINE_KEY,
  description:
    "Landing-page pricing headline: the current line vs “one flat monthly price” with the real amounts.",
  defaultValue: "control",
  options: [
    { value: "control", label: PRICING_HEADLINE_COPY.control.title },
    { value: "variant", label: PRICING_HEADLINE_COPY.variant.title },
  ],
  identify,
  decide({ entities }) {
    const id = entities?.visitor?.id;
    if (!id) return "control";
    return assignBucket(id, PRICING_HEADLINE_KEY, HEADLINE_VARIANTS);
  },
});

/**
 * Which plan card gets the “Recommended” highlight. Control is Pro, which
 * is what the page already does. The variant highlights Starter instead.
 */
export const pricingHighlightFlag = flag<HighlightVariant, Entities>({
  key: PRICING_HIGHLIGHT_KEY,
  description: "Which pricing card is visually highlighted: Pro (current) or Starter.",
  defaultValue: "pro",
  options: [
    { value: "pro", label: "Pro (current)" },
    { value: "starter", label: "Starter" },
  ],
  identify,
  decide({ entities }) {
    const id = entities?.visitor?.id;
    if (!id) return "pro";
    return assignBucket(id, PRICING_HIGHLIGHT_KEY, HIGHLIGHT_VARIANTS);
  },
});

export const pricingFlags = [pricingHeadlineFlag, pricingHighlightFlag] as const;
