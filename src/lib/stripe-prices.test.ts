import { afterEach, describe, expect, it, vi } from "vitest";
import { intervalPriceCents, planFromPriceId, stripePriceId, verifiedStripePriceId } from "./stripe-prices";

afterEach(() => vi.unstubAllEnvs());

type Price = { active: boolean; unit_amount: number | null; currency: string; recurring: { interval: string } | null };
const reader = (price: Price | Error) => ({
  prices: {
    retrieve: vi.fn(async () => {
      if (price instanceof Error) throw price;
      return price;
    }),
  },
});

describe("stripe prices", () => {
  it("lists $199 / $399 / $599 a month", () => {
    expect(intervalPriceCents("backup", "month")).toBe(19_900);
    expect(intervalPriceCents("starter", "month")).toBe(39_900);
    expect(intervalPriceCents("pro", "month")).toBe(59_900);
  });
  it("yearly is two months free", () => {
    expect(intervalPriceCents("backup", "year")).toBe(199_000);
    expect(intervalPriceCents("starter", "year")).toBe(399_000);
    expect(intervalPriceCents("pro", "year")).toBe(599_000);
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

describe("verifiedStripePriceId", () => {
  it("uses the named price when it charges the list amount", async () => {
    vi.stubEnv("STRIPE_PRICE_PRO_MONTHLY", "price_pro_m");
    const s = reader({ active: true, unit_amount: 59_900, currency: "usd", recurring: { interval: "month" } });
    expect(await verifiedStripePriceId(s, "pro", "month")).toBe("price_pro_m");
    expect(s.prices.retrieve).toHaveBeenCalledWith("price_pro_m");
  });

  it("falls back to inline when the named price still charges the old amount", async () => {
    vi.stubEnv("STRIPE_PRICE_BACKUP_MONTHLY", "price_old");
    const onMismatch = vi.fn();
    const s = reader({ active: true, unit_amount: 14_900, currency: "usd", recurring: { interval: "month" } });
    expect(await verifiedStripePriceId(s, "backup", "month", onMismatch)).toBeNull();
    expect(onMismatch).toHaveBeenCalledWith(expect.objectContaining({ expected: 19_900, actual: 14_900 }));
  });

  it("falls back on an archived price, a wrong interval, or a lookup error", async () => {
    vi.stubEnv("STRIPE_PRICE_STARTER_YEARLY", "price_sy");
    const ok = { active: true, unit_amount: 399_000, currency: "usd", recurring: { interval: "year" } };
    expect(await verifiedStripePriceId(reader({ ...ok, active: false }), "starter", "year")).toBeNull();
    expect(await verifiedStripePriceId(reader({ ...ok, recurring: { interval: "month" } }), "starter", "year")).toBeNull();
    expect(await verifiedStripePriceId(reader(new Error("No such price")), "starter", "year")).toBeNull();
    expect(await verifiedStripePriceId(reader(ok), "starter", "year")).toBe("price_sy");
  });

  it("doesn't call Stripe when no named price is set", async () => {
    vi.stubEnv("STRIPE_PRICE_PRO_MONTHLY", "");
    const s = reader({ active: true, unit_amount: 59_900, currency: "usd", recurring: { interval: "month" } });
    expect(await verifiedStripePriceId(s, "pro", "month")).toBeNull();
    expect(s.prices.retrieve).not.toHaveBeenCalled();
  });
});
