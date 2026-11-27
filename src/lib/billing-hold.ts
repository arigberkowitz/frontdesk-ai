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
