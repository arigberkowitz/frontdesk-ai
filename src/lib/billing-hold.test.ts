import { describe, expect, it } from "vitest";
import { LAPSE_GRACE_DAYS, numberReleaseDate, onTrialHold, type BillingHoldFacts } from "./billing-hold";

const endsAt = new Date("2026-10-16T17:00:00.000Z");
const ended: BillingHoldFacts = { status: "trial", comped: false, trialEndsAt: endsAt, subscriptionStatus: null };

describe("onTrialHold — a trial that ended unpaid only takes messages", () => {
  it("not before the trial ends; yes from the exact moment it ends", () => {
    expect(onTrialHold(ended, new Date(endsAt.getTime() - 1))).toBe(false);
    expect(onTrialHold(ended, endsAt)).toBe(true);
    expect(onTrialHold(ended, new Date(endsAt.getTime() + 60_000))).toBe(true);
  });

  it("paying (or a Stripe trial with a card) lifts it", () => {
    expect(onTrialHold({ ...ended, subscriptionStatus: "active" }, endsAt)).toBe(false);
    expect(onTrialHold({ ...ended, subscriptionStatus: "trialing" }, endsAt)).toBe(false);
  });

  it("a subscription that didn't go through doesn't", () => {
    for (const s of ["incomplete", "incomplete_expired", "past_due", "canceled", "unpaid"]) {
      expect(onTrialHold({ ...ended, subscriptionStatus: s }, endsAt)).toBe(true);
    }
  });

  it("comped businesses and trials with no end date are never held", () => {
    expect(onTrialHold({ ...ended, comped: true }, endsAt)).toBe(false);
    expect(onTrialHold({ ...ended, trialEndsAt: null }, endsAt)).toBe(false);
  });

  it("only applies to businesses still in trial", () => {
    for (const status of ["live", "paused", "draft"]) {
      expect(onTrialHold({ ...ended, status }, endsAt)).toBe(false);
    }
  });

  it("the number is released three days after the trial ends", () => {
    expect(LAPSE_GRACE_DAYS).toBe(3);
    expect(numberReleaseDate(endsAt).toISOString()).toBe("2026-10-19T17:00:00.000Z");
  });
});
