import "server-only";
import Stripe from "stripe";
import { env } from "./env";

/**
 * Stripe client (billing — §EPIC A4 / PRD §10). Behaves identically in test and
 * live mode — the only difference is whether STRIPE_SECRET_KEY is a test or live
 * key, so switching to real charges is a key swap, no code change.
 */
let cached: Stripe | null = null;

export function getStripe(): Stripe {
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not set — add your Stripe key to enable billing.");
  }
  cached ??= new Stripe(env.STRIPE_SECRET_KEY);
  return cached;
}

/** True when the configured key is a test-mode key (so the UI can flag it). */
export function isStripeTestMode(): boolean {
  return env.STRIPE_SECRET_KEY.startsWith("sk_test_");
}

/** Period end lives on the subscription in older API versions, on items in newer
 *  ones — read whichever is present so this survives Stripe API version bumps. */
export function subscriptionPeriodEnd(sub: Stripe.Subscription): Date | null {
  const top = (sub as unknown as { current_period_end?: number }).current_period_end;
  const item = sub.items?.data?.[0] as unknown as { current_period_end?: number } | undefined;
  const unix = top ?? item?.current_period_end;
  return unix ? new Date(unix * 1000) : null;
}
