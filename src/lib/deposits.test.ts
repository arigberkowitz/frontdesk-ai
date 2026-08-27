import { describe, it, expect } from "vitest";
import {
  MAX_DEPOSIT_CENTS,
  MIN_DEPOSIT_CENTS,
  decideDeposit,
  depositRequestBody,
  formatDeposit,
} from "./deposits";

const on = {
  depositsEnabled: true,
  depositLinkUrl: "https://buy.stripe.com/test_abc",
  serviceDepositCents: 2500,
};

describe("decideDeposit", () => {
  it("asks when everything is set up", () => {
    expect(decideDeposit(on)).toEqual({ required: true, amountCents: 2500, reason: "asked" });
  });

  it("stays quiet when the business hasn't turned deposits on", () => {
    expect(decideDeposit({ ...on, depositsEnabled: false }).required).toBe(false);
  });

  it("refuses to ask for money with nowhere to pay it", () => {
    expect(decideDeposit({ ...on, depositLinkUrl: null }).reason).toBe("no_link");
    expect(decideDeposit({ ...on, depositLinkUrl: "   " }).reason).toBe("no_link");
  });

  it("leaves services without a deposit alone — most services", () => {
    expect(decideDeposit({ ...on, serviceDepositCents: null }).reason).toBe(
      "service_has_no_deposit",
    );
    expect(decideDeposit({ ...on, serviceDepositCents: 0 }).reason).toBe(
      "service_has_no_deposit",
    );
  });

  it("rejects amounts that aren't really deposits", () => {
    expect(decideDeposit({ ...on, serviceDepositCents: MIN_DEPOSIT_CENTS - 1 }).reason).toBe(
      "amount_out_of_range",
    );
    expect(decideDeposit({ ...on, serviceDepositCents: MAX_DEPOSIT_CENTS + 1 }).reason).toBe(
      "amount_out_of_range",
    );
  });

  it("never returns an amount when it isn't asking", () => {
    for (const bad of [
      { ...on, depositsEnabled: false },
      { ...on, depositLinkUrl: null },
      { ...on, serviceDepositCents: null },
    ]) {
      expect(decideDeposit(bad).amountCents).toBeNull();
    }
  });
});

describe("depositRequestBody", () => {
  const base = {
    businessName: "Bright Smile Dental",
    customerName: "Jordan",
    amountCents: 2500,
    when: "Thursday, Aug 29 at 2:00 PM",
    payUrl: "https://buy.stripe.com/test_abc",
  };

  it("names the amount, the time and the link", () => {
    const body = depositRequestBody(base);
    expect(body).toContain("$25");
    expect(body).toContain("Thursday, Aug 29 at 2:00 PM");
    expect(body).toContain("https://buy.stripe.com/test_abc");
    expect(body).toContain("Reply STOP to opt out.");
  });

  it("confirms the booking rather than threatening it", () => {
    const body = depositRequestBody(base);
    expect(body).toContain("you're booked");
    expect(body).not.toMatch(/cancel|release|within \d+ (hour|minute)/i);
  });

  it("reads fine with no name", () => {
    const body = depositRequestBody({ ...base, customerName: null });
    expect(body.startsWith("Hi, you're booked")).toBe(true);
    expect(body).not.toContain("null");
  });
});

describe("formatDeposit", () => {
  it("drops the cents when they're zero", () => {
    expect(formatDeposit(2500)).toBe("$25");
    expect(formatDeposit(10000)).toBe("$100");
  });
  it("keeps them when they're not", () => {
    expect(formatDeposit(2750)).toBe("$27.50");
    expect(formatDeposit(999)).toBe("$9.99");
  });
});
