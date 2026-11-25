import { describe, expect, it } from "vitest";
import { isUsableVisitorId, newVisitorId, visitorCookieOptions } from "./visitor-id";

describe("visitor id", () => {
  it("accepts a uuid and rejects empty or huge values", () => {
    expect(isUsableVisitorId(newVisitorId())).toBe(true);
    expect(isUsableVisitorId("shot-000012")).toBe(true);
    expect(isUsableVisitorId("")).toBe(false);
    expect(isUsableVisitorId("short")).toBe(false);
    expect(isUsableVisitorId("x".repeat(129))).toBe(false);
    expect(isUsableVisitorId(undefined)).toBe(false);
  });

  it("sets a first-party, httpOnly cookie with a one-year life", () => {
    const opts = visitorCookieOptions(true);
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe("lax");
    expect(opts.secure).toBe(true);
    expect(opts.path).toBe("/");
    expect(opts.maxAge).toBe(60 * 60 * 24 * 365);
    expect(visitorCookieOptions(false).secure).toBe(false);
  });
});
