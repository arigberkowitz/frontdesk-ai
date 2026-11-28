import { describe, expect, it } from "vitest";
import {
  attachesStripeTrial,
  checkoutSubscriptionTrialParams,
  checkoutTrialEnd,
  type CheckoutTrialContext,
} from "./billing-trial";

const now = new Date("2026-11-27T12:00:00Z");
const days = (n: number) => new Date(now.getTime() + n * 86_400_000);

const midTrial: CheckoutTrialContext = { active: true, endsAt: days(13) };

describe("checkoutTrialEnd", () => {
  it("does not carry remaining in-app trial days onto Stripe (Buy now charges today)", () => {
    // This is the bug: 13 days left used to become Stripe "13 days free / $0 today".
    expect(checkoutTrialEnd(midTrial, now)).toBeUndefined();
  });

  it("charges immediately after the in-app trial has ended", () => {
    expect(checkoutTrialEnd({ active: false, expired: true, endsAt: days(-1) }, now)).toBeUndefined();
    expect(checkoutTrialEnd({ active: false, endsAt: null }, now)).toBeUndefined();
  });

  it("charges immediately on a messages-only or billing hold", () => {
    expect(
      checkoutTrialEnd({ active: false, expired: true, endsAt: days(-1), billingHold: true }, now),
    ).toBeUndefined();
  });

  it("never starts a second Stripe trial after cancel or a prior payment", () => {
    expect(
      checkoutTrialEnd({ ...midTrial, hadSubscription: true }, now),
    ).toBeUndefined();
    expect(
      checkoutTrialEnd({ active: false, endsAt: null, hadSubscription: true }, now),
    ).toBeUndefined();
    expect(
      checkoutTrialEnd({ active: false, endsAt: null, firstPaidAt: now }, now),
    ).toBeUndefined();
    expect(
      checkoutTrialEnd({ active: true, endsAt: days(10), priorCustomerOrEmail: true }, now),
    ).toBeUndefined();
  });
});

describe("checkoutSubscriptionTrialParams", () => {
  it("never sets trial_end or trial_period_days on any checkout path", () => {
    const cases: CheckoutTrialContext[] = [
      midTrial,
      { active: false, expired: true, endsAt: days(-1) },
      { active: false, expired: true, endsAt: days(-1), billingHold: true },
      { active: false, endsAt: null, hadSubscription: true },
      { active: false, endsAt: null, firstPaidAt: now },
      { active: true, endsAt: days(10), priorCustomerOrEmail: true },
      { active: false, endsAt: null },
    ];
    for (const ctx of cases) {
      const params = checkoutSubscriptionTrialParams(ctx, now);
      expect(params).toEqual({});
      expect(attachesStripeTrial(params)).toBe(false);
      expect(params).not.toHaveProperty("trial_end");
      expect(params).not.toHaveProperty("trial_period_days");
    }
  });
});
