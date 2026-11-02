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
