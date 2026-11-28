/**
 * When a Stripe Checkout session may attach a trial.
 *
 * The 14-day trial is in-app and needs no card. "Start my plan now", "Buy
 * now", and any checkout after the trial ends, on a messages-only hold, or
 * after a cancel charges the first month today. A business that has already
 * had a trial, a subscription, or a payment never gets a second Stripe
 * trial — including a new checkout from the same business, customer, or
 * email.
 *
 * This used to copy the remaining in-app days onto `subscription_data.trial_end`,
 * so a mid-trial "Buy now" opened Stripe on "13 days free / $0 today /
 * Start trial". That is gone: this function always returns undefined.
 */
export type CheckoutTrialContext = {
  /** In-app trial still running. */
  active: boolean;
  endsAt: Date | null;
  expired?: boolean;
  /** Messages-only hold after an unpaid trial or a failed payment. */
  billingHold?: boolean;
  /** Any prior subscription row (canceled, past_due, trialing, active, …). */
  hadSubscription?: boolean;
  firstPaidAt?: Date | null;
  /** Same Stripe customer or owner email already used a trial or subscription. */
  priorCustomerOrEmail?: boolean;
};

export function checkoutTrialEnd(
  _trial: CheckoutTrialContext,
  _now: Date = new Date(),
): number | undefined {
  return undefined;
}

/**
 * Spread onto `subscription_data` when opening Checkout. Always empty of
 * trial_end and trial_period_days so every checkout path charges today.
 */
export function checkoutSubscriptionTrialParams(
  trial: CheckoutTrialContext,
  now: Date = new Date(),
): { trial_end?: number; trial_period_days?: number } {
  const trialEnd = checkoutTrialEnd(trial, now);
  return trialEnd ? { trial_end: trialEnd } : {};
}

/** True when these params would start a Stripe trial — always false. */
export function attachesStripeTrial(
  params: { trial_end?: number; trial_period_days?: number },
): boolean {
  return params.trial_end != null || params.trial_period_days != null;
}
