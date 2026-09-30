import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({ env: { AGENT_TOOLS_SECRET: "s3cret" } }));
const { issueVerificationCode, checkVerificationCode, CODE_WINDOW_MS, verificationCodeText } =
  await import("./verification-code");

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("verification codes", () => {
  const now = 1_800_000_000_000;

  it("issues a 6-digit code that checks for the same client and number", () => {
    const code = issueVerificationCode(A, "+14155550100", now);
    expect(code).toMatch(/^\d{6}$/);
    expect(checkVerificationCode(A, "(415) 555-0100", code, now)).toBe(true);
  });

  it("is bound to the business and the number", () => {
    const code = issueVerificationCode(A, "+14155550100", now);
    expect(checkVerificationCode(B, "+14155550100", code, now)).toBe(false);
    expect(checkVerificationCode(A, "+14155550101", code, now)).toBe(false);
  });

  it("expires after the following window", () => {
    const code = issueVerificationCode(A, "+14155550100", now);
    expect(checkVerificationCode(A, "+14155550100", code, now + CODE_WINDOW_MS)).toBe(true);
    expect(checkVerificationCode(A, "+14155550100", code, now + 2 * CODE_WINDOW_MS + 1)).toBe(false);
  });

  it("rejects malformed input", () => {
    expect(checkVerificationCode(A, "+14155550100", "", now)).toBe(false);
    expect(checkVerificationCode(A, "+14155550100", "12345", now)).toBe(false);
    expect(checkVerificationCode(A, "", "123456", now)).toBe(false);
  });

  it("text names the business and never includes anything but the code", () => {
    const t = verificationCodeText("Acme Dental", "123456");
    expect(t).toContain("Acme Dental");
    expect(t).toContain("123456");
    expect(t).toContain("STOP");
  });
});
