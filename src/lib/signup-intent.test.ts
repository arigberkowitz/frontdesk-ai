import { describe, expect, it } from "vitest";
import { afterSignUpUrl, parseIntentInterval, parseIntentPlan, signUpHref } from "./signup-intent";

describe("signup intent", () => {
  it("parses valid plans and ignores junk", () => {
    expect(parseIntentPlan("pro")).toBe("pro");
    expect(parseIntentPlan(" Starter ")).toBe("starter");
    expect(parseIntentPlan(["backup", "pro"])).toBe("backup");
    expect(parseIntentPlan("enterprise")).toBeUndefined();
    expect(parseIntentPlan("<script>")).toBeUndefined();
    expect(parseIntentPlan(undefined)).toBeUndefined();
  });
  it("parses intervals and ignores junk", () => {
    expect(parseIntentInterval("year")).toBe("year");
    expect(parseIntentInterval("yearly")).toBe("year");
    expect(parseIntentInterval("annual")).toBe("year");
    expect(parseIntentInterval("month")).toBe("month");
    expect(parseIntentInterval("weekly")).toBeUndefined();
    expect(parseIntentInterval(42)).toBeUndefined();
  });
  it("builds hrefs", () => {
    expect(signUpHref("pro", "year")).toBe("/sign-up?plan=pro&interval=year");
    expect(signUpHref()).toBe("/sign-up");
    expect(signUpHref(undefined, "year")).toBe("/sign-up?interval=year");
  });
  it("builds the after-sign-up url, dropping junk", () => {
    expect(afterSignUpUrl("pro", "year")).toBe("/welcome?plan=pro&interval=year");
    expect(afterSignUpUrl("pro", "bogus")).toBe("/welcome?plan=pro");
    expect(afterSignUpUrl("x", "y")).toBe("/");
    expect(afterSignUpUrl("https://evil.com", undefined)).toBe("/");
  });
});
