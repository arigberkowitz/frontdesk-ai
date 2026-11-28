import { describe, expect, it } from "vitest";
import {
  assignPricingVariants,
  hash32,
  PRICING_HEADLINE_COPY,
  visitorIdFor,
} from "./pricing-experiment";

describe("pricing experiment assignment", () => {
  it("is stable for the same visitor id", () => {
    const a = assignPricingVariants("visitor-abc-1234");
    const b = assignPricingVariants("visitor-abc-1234");
    expect(a).toEqual(b);
  });

  it("can differ across visitors and across the two flags", () => {
    const ids = Array.from({ length: 40 }, (_, i) => `visitor-${i}-xxxx`);
    const headlines = new Set(ids.map((id) => assignPricingVariants(id).headline));
    const highlights = new Set(ids.map((id) => assignPricingVariants(id).highlight));
    expect(headlines.has("control")).toBe(true);
    expect(headlines.has("variant")).toBe(true);
    expect(highlights.has("pro")).toBe(true);
    expect(highlights.has("starter")).toBe(true);
  });

  it("splits roughly 50/50 over a large sample, independently per flag", () => {
    let headlineVariant = 0;
    let highlightStarter = 0;
    let both = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const got = assignPricingVariants(`sample-${i}`);
      if (got.headline === "variant") headlineVariant += 1;
      if (got.highlight === "starter") highlightStarter += 1;
      if (got.headline === "variant" && got.highlight === "starter") both += 1;
    }
    // Fair modulo on a 32-bit hash should land near half; allow a wide band
    // so a future hash tweak does not flake CI.
    expect(headlineVariant).toBeGreaterThan(n * 0.4);
    expect(headlineVariant).toBeLessThan(n * 0.6);
    expect(highlightStarter).toBeGreaterThan(n * 0.4);
    expect(highlightStarter).toBeLessThan(n * 0.6);
    // Independence: P(variant and starter) should be near 25%.
    expect(both).toBeGreaterThan(n * 0.18);
    expect(both).toBeLessThan(n * 0.32);
  });

  it("hash32 is a stable unsigned 32-bit hash", () => {
    expect(hash32("shot-0", 7)).toBe(hash32("shot-0", 7));
    expect(hash32("a")).not.toBe(hash32("b"));
    expect(hash32("visitor", 1)).not.toBe(hash32("visitor", 2));
  });

  it("visitorIdFor returns an id that matches the request", () => {
    const id = visitorIdFor({ headline: "variant", highlight: "pro" });
    expect(assignPricingVariants(id)).toEqual({ headline: "variant", highlight: "pro" });
    const control = visitorIdFor({ headline: "control", highlight: "pro" });
    expect(assignPricingVariants(control)).toEqual({ headline: "control", highlight: "pro" });
    const starter = visitorIdFor({ headline: "control", highlight: "starter" });
    expect(assignPricingVariants(starter)).toEqual({
      headline: "control",
      highlight: "starter",
    });
  });
});

describe("pricing experiment copy", () => {
  it("both arms use the house headline; control keeps its subhead", () => {
    expect(PRICING_HEADLINE_COPY.control.title).toBe("One flat monthly price");
    expect(PRICING_HEADLINE_COPY.control.sub).toContain("One price per location");
  });

  it("uses the house phrase and the real prices in the variant, without hype", () => {
    expect(PRICING_HEADLINE_COPY.variant.title).toBe("One flat monthly price");
    expect(PRICING_HEADLINE_COPY.variant.sub).toContain("$199, $399, or $599");
    expect(PRICING_HEADLINE_COPY.variant.sub.toLowerCase()).not.toMatch(
      /unlock|game-?changer|incredible|transform/i,
    );
  });
});
