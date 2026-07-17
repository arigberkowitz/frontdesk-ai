import { describe, expect, it } from "vitest";
import { normalizePhone } from "./sms-optouts";

/** STOP compliance hinges on phone formats matching between webhook and sends. */
describe("normalizePhone", () => {
  it("strips formatting and adds US country code to 10-digit numbers", () => {
    expect(normalizePhone("(305) 555-0100")).toBe("13055550100");
    expect(normalizePhone("305-555-0100")).toBe("13055550100");
  });
  it("keeps E.164-style input equivalent to formatted input", () => {
    expect(normalizePhone("+13055550100")).toBe(normalizePhone("305.555.0100"));
  });
  it("leaves 11+ digit numbers untouched", () => {
    expect(normalizePhone("+13055550100")).toBe("13055550100");
  });
});
