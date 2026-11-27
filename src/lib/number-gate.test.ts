import { describe, expect, it } from "vitest";
import { isUnpaidTrialUnlock, numberGate, TRIAL_NUMBERS_PER_DAY, type NumberGateFacts } from "./number-gate";

/** When a business may get its own phone number: a running free trial after one test call, or a payment/card. */

const NOW = new Date("2026-11-27T12:00:00Z");
const inAWeek = new Date(NOW.getTime() + 7 * 86_400_000);

const freshTrial: NumberGateFacts = {
  actorRole: "client_admin",
  status: "trial",
  comped: false,
  subscriptionStatus: null,
  firstPaid: false,
  trialEndsAt: inAWeek,
  trialLapsed: false,
  trialApproved: false,
  hasTestCall: false,
  trialNumbersToday: 0,
};

describe("numberGate — free trials get a real number again", () => {
  it("a fresh trial is one test call away", () => {
    expect(numberGate(freshTrial, NOW)).toEqual({ unlocked: false, via: null, reason: "needs_test_call" });
  });

  it("one test call unlocks it", () => {
    expect(numberGate({ ...freshTrial, hasTestCall: true }, NOW)).toEqual({ unlocked: true, via: "trial", reason: null });
  });

  it("an operator-approved trial doesn't need the test call", () => {
    expect(numberGate({ ...freshTrial, trialApproved: true }, NOW).via).toBe("approved_trial");
  });

  it("abuse: the platform-wide daily cap on trial numbers holds the rest until tomorrow", () => {
    const capped = { ...freshTrial, hasTestCall: true, trialNumbersToday: TRIAL_NUMBERS_PER_DAY };
    expect(numberGate(capped, NOW)).toEqual({ unlocked: false, via: null, reason: "daily_cap" });
    expect(numberGate({ ...capped, trialNumbersToday: TRIAL_NUMBERS_PER_DAY - 1 }, NOW).unlocked).toBe(true);
    // Paying customers are never held by the trial cap.
    expect(numberGate({ ...capped, subscriptionStatus: "active" }, NOW).unlocked).toBe(true);
  });

  it("an ended trial, a lapsed one (number already released) or one with no end date never gets one", () => {
    const tested = { ...freshTrial, hasTestCall: true };
    expect(numberGate({ ...tested, trialEndsAt: NOW }, NOW).reason).toBe("trial_ended");
    expect(numberGate({ ...tested, trialLapsed: true }, NOW).reason).toBe("trial_ended");
    expect(numberGate({ ...tested, trialEndsAt: null }, NOW).reason).toBe("trial_ended");
    expect(numberGate({ ...tested, trialApproved: true, trialEndsAt: NOW }, NOW).unlocked).toBe(false);
  });

  it("a paused-after-lapse business waits for a plan", () => {
    expect(numberGate({ ...freshTrial, status: "paused", hasTestCall: true, trialLapsed: true }, NOW)).toMatchObject({
      unlocked: false,
      reason: "needs_plan",
    });
  });
});

describe("numberGate — paying, carded, comped, operators", () => {
  it("a recorded payment or an active subscription unlocks it", () => {
    expect(numberGate({ ...freshTrial, firstPaid: true }, NOW).via).toBe("paid");
    expect(numberGate({ ...freshTrial, firstPaid: true, subscriptionStatus: "past_due" }, NOW).unlocked).toBe(true);
    expect(numberGate({ ...freshTrial, subscriptionStatus: "active" }, NOW).via).toBe("paid");
  });

  it("a card on file (Stripe trial) unlocks it", () => {
    expect(numberGate({ ...freshTrial, subscriptionStatus: "trialing" }, NOW).via).toBe("card");
    expect(numberGate({ ...freshTrial, status: "live", subscriptionStatus: "trialing" }, NOW).via).toBe("card");
  });

  it("a subscription that didn't go through, on a live business, does not", () => {
    for (const s of ["incomplete", "past_due", "canceled", "paused"]) {
      expect(numberGate({ ...freshTrial, status: "live", subscriptionStatus: s }, NOW)).toMatchObject({
        unlocked: false,
        reason: "needs_plan",
      });
    }
  });

  it("operators always; comped; live without Stripe (an off-Stripe deal)", () => {
    expect(numberGate({ ...freshTrial, actorRole: "operator", status: "draft" }, NOW).via).toBe("operator");
    expect(numberGate({ ...freshTrial, comped: true }, NOW).via).toBe("comped");
    expect(numberGate({ ...freshTrial, status: "live" }, NOW).via).toBe("live");
  });

  it("staff and the system follow the business's state, not their own", () => {
    expect(numberGate({ ...freshTrial, actorRole: "client_viewer" }, NOW).unlocked).toBe(false);
    expect(numberGate({ ...freshTrial, actorRole: "system" }, NOW).unlocked).toBe(false);
    expect(numberGate({ ...freshTrial, actorRole: "system", hasTestCall: true }, NOW).unlocked).toBe(true);
  });

  it("only the unpaid-trial paths count toward the daily cap", () => {
    expect(isUnpaidTrialUnlock("trial")).toBe(true);
    expect(isUnpaidTrialUnlock("approved_trial")).toBe(true);
    for (const v of ["paid", "card", "comped", "live", "operator", null] as const) {
      expect(isUnpaidTrialUnlock(v)).toBe(false);
    }
  });
});
