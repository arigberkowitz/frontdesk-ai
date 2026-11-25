import { afterEach, describe, expect, it, vi } from "vitest";
import { trackEvent } from "./analytics-track";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("trackEvent", () => {
  it("is a no-op when window is missing", () => {
    expect(() => trackEvent("pricing_cta", { headline: "control" })).not.toThrow();
  });

  it("calls window.va when the analytics snippet is present", () => {
    const va = vi.fn();
    vi.stubGlobal("window", { va });
    trackEvent("pricing_cta", { headline: "variant", plan: "pro" });
    expect(va).toHaveBeenCalledWith("event", {
      name: "pricing_cta",
      data: { headline: "variant", plan: "pro" },
    });
  });

  it("queues on window.vaq when the snippet has not loaded yet", () => {
    const w: { vaq?: unknown[] } = {};
    vi.stubGlobal("window", w);
    trackEvent("pricing_impression", { headline: "control", highlight: "pro" });
    expect(w.vaq).toEqual([
      [
        "event",
        { name: "pricing_impression", data: { headline: "control", highlight: "pro" } },
      ],
    ]);
  });
});
