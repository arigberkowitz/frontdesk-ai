import { describe, it, expect } from "vitest";
import { confirmationMatches } from "./account-close";

/**
 * The typed-name gate is the only thing standing between a misclick and a
 * closed phone line, so it gets tested directly rather than through the form.
 */
describe("confirmationMatches", () => {
  it("accepts the exact name", () => {
    expect(confirmationMatches("Bright Smile Dental", "Bright Smile Dental")).toBe(true);
  });

  it("forgives case and stray whitespace — a phone keyboard is not a password field", () => {
    expect(confirmationMatches("  bright smile   dental ", "Bright Smile Dental")).toBe(true);
  });

  it("rejects empty input, so a bare submit can never close an account", () => {
    expect(confirmationMatches("", "Bright Smile Dental")).toBe(false);
    expect(confirmationMatches("   ", "Bright Smile Dental")).toBe(false);
  });

  it("rejects a near miss", () => {
    expect(confirmationMatches("Bright Smile", "Bright Smile Dental")).toBe(false);
    expect(confirmationMatches("Bright Smile Dental Inc", "Bright Smile Dental")).toBe(false);
  });

  it("rejects the word people type by reflex instead of the name", () => {
    expect(confirmationMatches("DELETE", "Bright Smile Dental")).toBe(false);
  });
});
