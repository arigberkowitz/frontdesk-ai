import "server-only";
import { getStripe } from "@/lib/stripe";
import { integrations } from "@/lib/env";
import { logger } from "@/lib/logger";
import type { BillingInterval } from "@/lib/stripe-prices";

/**
 * Monthly or yearly, read from Stripe (we don't store it). The plan card
 * quotes prices in the interval they actually pay; falls back to monthly
 * when Stripe can't be reached so the page still renders.
 */
export async function subscriptionInterval(subId: string | null | undefined): Promise<BillingInterval> {
  if (!subId || !integrations.stripe()) return "month";
  try {
    const sub = await getStripe().subscriptions.retrieve(subId);
    return sub.items.data[0]?.price.recurring?.interval === "year" ? "year" : "month";
  } catch (err) {
    logger.warn("billing.interval_read_failed", { error: err instanceof Error ? err.message : String(err) });
    return "month";
  }
}
