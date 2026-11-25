import { afterEach, describe, expect, it, vi } from "vitest";

const track = vi.fn();
vi.mock("@vercel/analytics", () => ({
  track: (...args: unknown[]) => track(...args),
}));

import { trackEvent } from "./analytics-track";

afterEach(() => {
  track.mockReset();
  vi.unstubAllGlobals();
});

describe("trackEvent", () => {
  it("is a no-op when window is missing", () => {
    expect(() => trackEvent("pricing_cta", { headline: "control" })).not.toThrow();
    expect(track).not.toHaveBeenCalled();
  });

  it("forwards the event name and properties to track()", () => {
    vi.stubGlobal("window", {});
    trackEvent("pricing_cta", { headline: "variant", plan: "pro" });
    expect(track).toHaveBeenCalledWith("pricing_cta", {
      headline: "variant",
      plan: "pro",
    });
  });

  it("does not throw if track() throws", () => {
    vi.stubGlobal("window", {});
    track.mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() =>
      trackEvent("pricing_impression", { headline: "control", highlight: "pro" }),
    ).not.toThrow();
  });
});
