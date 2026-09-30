import { describe, expect, it } from "vitest";
import { composeReply, MAX_REPLY_CHARS, validateReply } from "./sms-reply";

describe("validateReply", () => {
  it("trims and accepts normal text", () => {
    expect(validateReply("  See you at 3!  ")).toEqual({ ok: true, text: "See you at 3!" });
  });
  it("rejects empty and whitespace-only input", () => {
    expect(validateReply("").ok).toBe(false);
    expect(validateReply("   \n\t ").ok).toBe(false);
    expect(validateReply(null).ok).toBe(false);
  });
  it("rejects input over the max, after trimming", () => {
    expect(validateReply("x".repeat(MAX_REPLY_CHARS)).ok).toBe(true);
    expect(validateReply(`  ${"x".repeat(MAX_REPLY_CHARS)}  `).ok).toBe(true);
    expect(validateReply("x".repeat(MAX_REPLY_CHARS + 1)).ok).toBe(false);
  });
});

describe("composeReply", () => {
  it("prefixes the business name so the shared number is identifiable", () => {
    expect(composeReply("See you at 3!", { businessName: "Acme Dental", includeOptOut: false })).toBe(
      "Acme Dental: See you at 3!",
    );
  });
  it("doesn't prefix when the owner already named the business", () => {
    expect(
      composeReply("Hi, it's acme dental — see you at 3!", { businessName: "Acme Dental", includeOptOut: false }),
    ).toBe("Hi, it's acme dental — see you at 3!");
  });
  it("no business name → no prefix", () => {
    expect(composeReply("Hello", { businessName: "", includeOptOut: false })).toBe("Hello");
  });
  it("adds the opt-out line only when asked", () => {
    expect(composeReply("Hello", { businessName: "Acme", includeOptOut: true })).toBe(
      "Acme: Hello Reply STOP to opt out.",
    );
  });
});
