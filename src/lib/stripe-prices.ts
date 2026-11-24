import { PLANS, type PlanKey } from "@/config/plans";


export type BillingInterval = "month" | "year";

/**
 * Optional pre-made Stripe Price IDs, one per plan and interval:
 *   STRIPE_PRICE_{BACKUP|STARTER|PRO}_{MONTHLY|YEARLY}
 *
 * When one is set, checkout uses it, so the Stripe dashboard shows a real
 * product and price. When it isn't, checkout falls back to an inline price
 * built from PLANS — the yearly option still works (10× monthly, two months
 * free), it just isn't a named Price in Stripe.
 */
const SOLD: PlanKey[] = ["backup", "starter", "pro"];

function envName(plan: PlanKey, interval: BillingInterval): string {
  return `STRIPE_PRICE_${plan.toUpperCase()}_${interval === "year" ? "YEARLY" : "MONTHLY"}`;
}

export function stripePriceId(plan: PlanKey, interval: BillingInterval): string | null {
  const v = process.env[envName(plan, interval)]?.trim();
  return v ? v : null;
}

/** Map a Stripe Price ID (monthly or yearly) back to its plan. */
export function planFromPriceId(priceId: string | null | undefined): PlanKey | null {
  if (!priceId) return null;
  for (const key of SOLD) {
    if (stripePriceId(key, "month") === priceId || stripePriceId(key, "year") === priceId) return key;
  }
  return null;
}

/** Yearly = 10 months' price. */
export function intervalPriceCents(plan: PlanKey, interval: BillingInterval): number {
  const m = PLANS[plan].monthlyPriceCents;
  return interval === "year" ? m * 10 : m;
}

/** The slice of the Stripe client this module needs — keeps it unit-testable. */
export interface PriceReader {
  prices: {
    retrieve(id: string): Promise<{
      active: boolean;
      unit_amount: number | null;
      currency: string;
      recurring: { interval: string } | null;
    }>;
  };
}

/**
 * The named Price to charge — but only if it still charges what the site
 * says.
 *
 * A Price in Stripe is immutable, so when the list price in PLANS changes, the
 * STRIPE_PRICE_* env var keeps pointing at the old amount until someone makes
 * a new Price and swaps the env. Without this check, the pricing page would
 * show the new number while checkout quietly charged the old one. A mismatch
 * (or a Price Stripe can't find) falls back to an inline price built from
 * PLANS, which is always the amount on the page.
 */
export async function verifiedStripePriceId(
  stripe: PriceReader,
  plan: PlanKey,
  interval: BillingInterval,
  onMismatch?: (detail: Record<string, unknown>) => void,
): Promise<string | null> {
  const id = stripePriceId(plan, interval);
  if (!id) return null;
  const expected = intervalPriceCents(plan, interval);
  try {
    const price = await stripe.prices.retrieve(id);
    if (
      price.active &&
      price.currency === "usd" &&
      price.unit_amount === expected &&
      price.recurring?.interval === interval
    ) {
      return id;
    }
    onMismatch?.({
      plan,
      interval,
      priceId: id,
      expected,
      actual: price.unit_amount,
      active: price.active,
      priceInterval: price.recurring?.interval ?? null,
    });
  } catch (err) {
    onMismatch?.({ plan, interval, priceId: id, error: err instanceof Error ? err.message : String(err) });
  }
  return null;
}
