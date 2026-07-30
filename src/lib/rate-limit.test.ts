import { describe, expect, it } from "vitest";
import { clearAttempts, consumeAttempt, formatRetryAfter } from "@/lib/rate-limit";

describe("rate limit", () => {
  it("allows up to the limit then blocks", () => {
    const k = `t${Math.random()}`;
    for (let i = 0; i < 5; i++) expect(consumeAttempt(k, 5).ok).toBe(true);
    const blocked = consumeAttempt(k, 5);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it("clearing on success resets the counter", () => {
    const k = `t${Math.random()}`;
    consumeAttempt(k, 2);
    consumeAttempt(k, 2);
    expect(consumeAttempt(k, 2).ok).toBe(false);
    clearAttempts(k);
    expect(consumeAttempt(k, 2).ok).toBe(true);
  });

  it("keys are independent", () => {
    const a = `a${Math.random()}`, b = `b${Math.random()}`;
    consumeAttempt(a, 1);
    expect(consumeAttempt(a, 1).ok).toBe(false);
    expect(consumeAttempt(b, 1).ok).toBe(true);
  });

  it("formats retry windows for humans", () => {
    expect(formatRetryAfter(45)).toBe("45 seconds");
    expect(formatRetryAfter(120)).toBe("2 minutes");
    expect(formatRetryAfter(1)).toBe("1 second");
  });
});
