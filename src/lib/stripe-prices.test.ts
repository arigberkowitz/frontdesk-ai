import { afterEach, describe, expect, it, vi } from "vitest";
import { intervalPriceCents, planFromPriceId, stripePriceId } from "./stripe-prices";

afterEach(() => vi.unstubAllEnvs());

describe("stripe prices", () => {
  it("yearly is two months free", () => {
    expect(intervalPriceCents("backup", "year")).toBe(149_000);
    expect(intervalPriceCents("starter", "year")).toBe(300_000);
    expect(intervalPriceCents("pro", "year")).toBe(500_000);
    expect(intervalPriceCents("pro", "month")).toBe(50_000);
  });
  it("missing env means inline price", () => {
    vi.stubEnv("STRIPE_PRICE_PRO_YEARLY", "");
    expect(stripePriceId("pro", "year")).toBeNull();
  });
  it("maps monthly and yearly price IDs to the same plan", () => {
    vi.stubEnv("STRIPE_PRICE_STARTER_MONTHLY", "price_sm");
    vi.stubEnv("STRIPE_PRICE_STARTER_YEARLY", "price_sy");
    expect(planFromPriceId("price_sm")).toBe("starter");
    expect(planFromPriceId("price_sy")).toBe("starter");
    expect(planFromPriceId("price_other")).toBeNull();
  });
});
