import { describe, expect, it } from "vitest";
import { checkoutTrialEnd } from "./billing-trial";

const now = new Date("2026-11-04T12:00:00Z");
const days = (n: number) => new Date(now.getTime() + n * 86_400_000);

describe("checkoutTrialEnd", () => {
  it("carries the remaining trial onto the subscription", () => {
    const endsAt = days(11);
    expect(checkoutTrialEnd({ active: true, endsAt }, now)).toBe(Math.floor(endsAt.getTime() / 1000));
  });
  it("bills now when under Stripe's 48h minimum", () => {
    expect(checkoutTrialEnd({ active: true, endsAt: days(1.5) }, now)).toBeUndefined();
    expect(checkoutTrialEnd({ active: true, endsAt: days(2) }, now)).toBeUndefined();
  });
  it("adds nothing once the trial is over or absent", () => {
    expect(checkoutTrialEnd({ active: false, endsAt: days(-1) }, now)).toBeUndefined();
    expect(checkoutTrialEnd({ active: false, endsAt: null }, now)).toBeUndefined();
  });
});
