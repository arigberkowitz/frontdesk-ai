import { describe, expect, it, vi } from "vitest";
import { cancelBillingOnClose, type CloseBillingDeps } from "./account-close-billing";

type Sub = Awaited<ReturnType<CloseBillingDeps["getSubscription"]>>;

function deps(sub: Sub, o: Partial<CloseBillingDeps> & { stripe?: Record<string, "open" | "canceled"> } = {}) {
  const stripe = o.stripe ?? {};
  const state = { sub };
  const d: CloseBillingDeps = {
    stripeConfigured: o.stripeConfigured ?? true,
    getSubscription: vi.fn(async () => state.sub),
    markSubscriptionStatus: vi.fn(async (_id, status) => {
      if (state.sub) state.sub = { ...state.sub, status };
    }),
    // Mock Stripe: canceling an open sub cancels it; a canceled or unknown one is "already gone".
    stripeCancel: o.stripeCancel ?? vi.fn(async (id: string) => {
      if (stripe[id] === "open") {
        stripe[id] = "canceled";
        return "done" as const;
      }
      return "already_gone" as const;
    }),
    stripeOpenSubscriptionsFor: vi.fn(async () => Object.keys(stripe).filter((k) => stripe[k] === "open")),
    stripeSubscriptionsByClient: vi.fn(async () => []),
  };
  return { d, stripe, state };
}

describe("cancelBillingOnClose", () => {
  it("cancels an active subscription immediately with no proration", async () => {
    const { d, stripe, state } = deps(
      { stripeSubscriptionId: "sub_1", stripeCustomerId: "cus_1", status: "active" },
      { stripe: { sub_1: "open" } },
    );
    const r = await cancelBillingOnClose("c1", d);
    expect(r).toEqual({ status: "canceled", ids: ["sub_1"] });
    expect(d.stripeCancel).toHaveBeenCalledWith("sub_1", { prorate: false });
    expect(stripe.sub_1).toBe("canceled");
    expect(state.sub?.status).toBe("canceled");
  });

  it("also cancels other open subscriptions on the same customer", async () => {
    const { d, stripe } = deps(
      { stripeSubscriptionId: "sub_1", stripeCustomerId: "cus_1", status: "trialing" },
      { stripe: { sub_1: "open", sub_2: "open" } },
    );
    const r = await cancelBillingOnClose("c1", d);
    expect(r.status).toBe("canceled");
    expect(stripe).toEqual({ sub_1: "canceled", sub_2: "canceled" });
  });

  it("is idempotent: a second run finds nothing left to cancel", async () => {
    const { d } = deps(
      { stripeSubscriptionId: "sub_1", stripeCustomerId: "cus_1", status: "active" },
      { stripe: { sub_1: "open" } },
    );
    await cancelBillingOnClose("c1", d);
    const again = await cancelBillingOnClose("c1", d);
    expect(again).toEqual({ status: "already_canceled", ids: [] });
    expect(d.stripeCancel).toHaveBeenCalledTimes(1);
  });

  it("treats a subscription Stripe already canceled as done", async () => {
    const { d } = deps(
      { stripeSubscriptionId: "sub_1", stripeCustomerId: "cus_1", status: "active" },
      { stripe: { sub_1: "canceled" } },
    );
    const r = await cancelBillingOnClose("c1", d);
    expect(r).toEqual({ status: "already_canceled", ids: ["sub_1"] });
  });

  it("does nothing when there was never a subscription", async () => {
    const { d } = deps(null);
    expect(await cancelBillingOnClose("c1", d)).toEqual({ status: "none" });
    expect(d.stripeCancel).not.toHaveBeenCalled();
    expect(d.markSubscriptionStatus).not.toHaveBeenCalled();
  });

  it("does nothing on a trial with no card, even when Stripe is not configured", async () => {
    const { d } = deps(null, { stripeConfigured: false });
    expect(await cancelBillingOnClose("c1", d)).toEqual({ status: "none" });
  });

  it("fails loudly when a subscription is on file but Stripe is not configured", async () => {
    const { d } = deps(
      { stripeSubscriptionId: "sub_1", stripeCustomerId: "cus_1", status: "active" },
      { stripeConfigured: false },
    );
    const r = await cancelBillingOnClose("c1", d);
    expect(r.status).toBe("failed");
  });

  it("reports a Stripe error as failed instead of throwing", async () => {
    const { d } = deps(
      { stripeSubscriptionId: "sub_1", stripeCustomerId: "cus_1", status: "active" },
      { stripeCancel: vi.fn(async () => { throw new Error("Stripe is down"); }) },
    );
    const r = await cancelBillingOnClose("c1", d);
    expect(r).toEqual({ status: "failed", error: "Stripe is down" });
    expect(d.markSubscriptionStatus).not.toHaveBeenCalled();
  });
});
