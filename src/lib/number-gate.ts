/**
 * When a business may get its own phone number.
 *
 * A free trial gets a real number again (Ari, Nov 2026: "Give trials a phone
 * number again"). The cold-email offer is "14 days free, no card", and a
 * trial that can only be heard in a browser isn't the product a business
 * owner is trying out. The cost stays bounded by four guardrails:
 *
 *   1. One proof of a real person first: a trial's number unlocks once the
 *      owner has made one test call to their AI (the browser test call
 *      counts). A throwaway signup script doesn't sit through a call; an owner
 *      trying it does it in the first five minutes anyway.
 *   2. One number per business, ever, at a time: the first-provision lock
 *      (provision-lock.ts) makes a double click, two tabs or a replayed
 *      webhook buy exactly one.
 *   3. A platform-wide daily cap on numbers bought for unpaid trials
 *      (TRIAL_NUMBERS_PER_DAY, checked in data/number-gate.ts), so a burst
 *      of fake signups can't run up the vendor bill overnight.
 *   4. An expired trial never gets one. When a trial ends unpaid the AI only
 *      takes messages (billing-hold.ts) and three days later the number is
 *      released (trial-lapse.ts); paying turns everything back on.
 *
 * A number also unlocks when:
 *   - an operator is doing it (the operator dashboard can always provision);
 *   - the business has paid (a recorded first payment, or an active
 *     subscription when the invoice event is late) or has a card on file (a
 *     Stripe trial — a saved card is a stronger signal than a test call);
 *   - it's comped (someone we know, free on purpose);
 *   - it's "live" with no Stripe subscription: an off-Stripe deal an operator
 *     set live;
 *   - an operator approved this trial (trial-code flow) and it hasn't ended.
 *
 * Pure: the facts come from `data/number-gate.ts`, so the rules are testable.
 */

/** Most numbers we'll buy for unpaid trials in any 24 hours, across all businesses. */
export const TRIAL_NUMBERS_PER_DAY = 25;

export type NumberUnlockVia = "operator" | "paid" | "card" | "comped" | "live" | "approved_trial" | "trial";

/** Why a number is still locked, so the page can say what to do next. */
export type NumberLockReason =
  /** Trial running, no test call yet: "make a test call and your number is yours". */
  | "needs_test_call"
  /** Unlocked by the trial, but today's platform-wide trial cap is used up. */
  | "daily_cap"
  /** The free trial is over: pick a plan. */
  | "trial_ended"
  /** Anything else (draft, cancelled subscription, …): pick a plan. */
  | "needs_plan";

export interface NumberGateFacts {
  /** Who is asking. "system" = a webhook acting on the business's own state. */
  actorRole: "operator" | "client_admin" | "client_viewer" | "system";
  status: string;
  comped: boolean;
  /** The business's Stripe subscription status, or null with none. */
  subscriptionStatus: string | null;
  /** Stripe has collected a real (over $0) payment from this business. */
  firstPaid: boolean;
  /** When the free trial ends (null: never stamped). */
  trialEndsAt: Date | null;
  /** The trial-lapse job released this business's number (it's paused until it pays). */
  trialLapsed: boolean;
  /** An operator approved this trial (trial-code flow). */
  trialApproved: boolean;
  /** The owner has made at least one call to the AI (the browser test call counts). */
  hasTestCall: boolean;
  /** Numbers bought for unpaid trials in the last 24 hours, platform-wide. */
  trialNumbersToday: number;
}

export interface NumberGate {
  unlocked: boolean;
  via: NumberUnlockVia | null;
  /** Set when locked. */
  reason: NumberLockReason | null;
}

export function numberGate(f: NumberGateFacts, now: Date = new Date()): NumberGate {
  const open = (via: NumberUnlockVia): NumberGate => ({ unlocked: true, via, reason: null });
  const shut = (reason: NumberLockReason): NumberGate => ({ unlocked: false, via: null, reason });

  if (f.actorRole === "operator") return open("operator");
  if (f.firstPaid || f.subscriptionStatus === "active") return open("paid");
  if (f.subscriptionStatus === "trialing") return open("card");
  if (f.comped) return open("comped");
  if (f.status === "live" && f.subscriptionStatus === null) return open("live");

  if (f.status !== "trial") return shut("needs_plan");
  // A lapsed trial (number already released) or one past its end date waits
  // for a plan. No end date at all can't prove the trial is running.
  if (f.trialLapsed || !f.trialEndsAt || f.trialEndsAt.getTime() <= now.getTime()) {
    return shut("trial_ended");
  }
  const via: NumberUnlockVia | null = f.trialApproved ? "approved_trial" : f.hasTestCall ? "trial" : null;
  if (!via) return shut("needs_test_call");
  if (f.trialNumbersToday >= TRIAL_NUMBERS_PER_DAY) return shut("daily_cap");
  return open(via);
}

/** Unlock paths that put a number on an unpaid trial (they count toward the daily cap). */
export function isUnpaidTrialUnlock(via: NumberUnlockVia | null): boolean {
  return via === "trial" || via === "approved_trial";
}
