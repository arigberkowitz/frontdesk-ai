import { describe, expect, it } from "vitest";
import { formatUsPhone, numberProblem, samePhone, toE164, type TwilioNumberCheck } from "./sms-number-format";

describe("toE164", () => {
  it("normalizes pasted US numbers", () => {
    expect(toE164("(415) 555-0123")).toBe("+14155550123");
    expect(toE164("415.555.0123")).toBe("+14155550123");
    expect(toE164("+1 415 555 0123")).toBe("+14155550123");
    expect(toE164("14155550123")).toBe("+14155550123");
  });
  it("rejects things that aren't a US/Canada number", () => {
    for (const bad of ["", "555-0123", "+44 20 7946 0958", "0155550123", "11155550123", "abc"]) {
      expect(toE164(bad)).toBeNull();
    }
  });
});

describe("samePhone / formatUsPhone", () => {
  it("compares regardless of formatting", () => {
    expect(samePhone("+14155550123", "(415) 555-0123")).toBe(true);
    expect(samePhone("+14155550123", "+14155550124")).toBe(false);
    expect(samePhone("", "")).toBe(false);
  });
  it("formats for display", () => {
    expect(formatUsPhone("+14155550123")).toBe("(415) 555-0123");
  });
});

describe("numberProblem", () => {
  const ok: TwilioNumberCheck = {
    checked: true,
    found: true,
    smsCapable: true,
    webhookOk: true,
    smsUrl: null,
    isShared: false,
  };
  it("accepts a number that's in the account and can text", () => {
    expect(numberProblem(ok)).toBeNull();
    // Webhook misconfiguration is a warning, not a refusal.
    expect(numberProblem({ ...ok, webhookOk: false })).toBeNull();
  });
  it("refuses the shared number, a number not in the account, or one that can't text", () => {
    expect(numberProblem({ ...ok, isShared: true })).toMatch(/shared number/);
    expect(numberProblem({ ...ok, found: false })).toMatch(/isn't in this Twilio account/);
    expect(numberProblem({ ...ok, smsCapable: false })).toMatch(/can't send texts/);
  });
  it("allows saving unverified when Twilio isn't configured (the action warns)", () => {
    expect(numberProblem({ ...ok, checked: false, found: false })).toBeNull();
  });
});
