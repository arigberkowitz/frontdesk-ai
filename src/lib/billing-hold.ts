/**
 * "The free trial ran out and nobody paid": the receptionist stops doing the
 * paid work — no booking, no answering questions — and only takes messages,
 * so a caller still reaches a person eventually and the owner still hears
 * about every call. Pure, so the rule is argued in a test.
 *
 * Three days later trial-lapse.ts releases the number and pauses the
 * business outright. Paying at any point puts everything back (the Stripe
 * webhook republishes the agent; a subscription that is active or in a Stripe
 * trial is never on hold).
 */

/** Days after a trial ends unpaid before its number is released (trial-lapse.ts). */
export const LAPSE_GRACE_DAYS = 3;

/** When an unpaid trial's number is released: the trial end plus the grace. */
export function numberReleaseDate(trialEndsAt: Date): Date {
  return new Date(trialEndsAt.getTime() + LAPSE_GRACE_DAYS * 24 * 60 * 60 * 1000);
}

export interface BillingHoldFacts {
  status: string;
  comped: boolean;
  trialEndsAt: Date | null;
  /** The business's Stripe subscription status, or null with none. */
  subscriptionStatus: string | null;
}

export function onTrialHold(f: BillingHoldFacts, now: Date = new Date()): boolean {
  if (f.status !== "trial") return false; // live / paused / draft are decided elsewhere
  if (f.comped) return false;
  if (f.subscriptionStatus === "active" || f.subscriptionStatus === "trialing") return false;
  // No end date: a trial granted before we stamped one. Never cut those off.
  if (!f.trialEndsAt) return false;
  return f.trialEndsAt.getTime() <= now.getTime();
}

/**
 * "A paying business stopped paying": the same messages-only hold, for a live
 * business whose Stripe subscription has ended. That's `canceled` — Stripe's
 * default once every retry of a failed payment has run out, and also where an
 * owner's own cancellation lands at the end of the period they paid for — or
 * Stripe's `unpaid` (retries exhausted, subscription kept), which we store as
 * past_due plus the `stripeUnpaid` flag.
 *
 * Plain past_due is NOT a hold: Stripe is still retrying, the owner has been
 * emailed to fix the card, and cutting the service mid-retry would punish an
 * expired card. The number is kept (an operator decides whether to release
 * it); paying again republishes the full agent.
 */
export interface PaymentHoldFacts {
  status: string;
  comped: boolean;
  subscriptionStatus: string | null;
  stripeUnpaid: boolean;
}

export function onPaymentHold(f: PaymentHoldFacts): boolean {
  if (f.comped) return false;
  if (f.status !== "live") return false; // trial: onTrialHold; paused: already messages-only
  if (f.subscriptionStatus === "canceled") return true;
  return f.subscriptionStatus === "past_due" && f.stripeUnpaid;
}

/** Either hold: the receptionist only takes messages. */
export function onBillingHold(
  f: BillingHoldFacts & { stripeUnpaid: boolean },
  now: Date = new Date(),
): boolean {
  return onTrialHold(f, now) || onPaymentHold(f);
}
