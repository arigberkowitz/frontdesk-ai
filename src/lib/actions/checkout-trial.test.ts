import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Checkout must charge today: no Stripe trial on "Buy now" during an
 * in-app trial, after the trial ends, on a billing hold, or on a
 * re-subscribe. Session params are asserted against a fake Stripe
 * (no live secret).
 */

let owner = true;
let trialState: {
  active: boolean;
  expired: boolean;
  daysLeft: number;
  endsAt: Date | null;
  comped: boolean;
  subscribed: boolean;
};
let subRow: { subId: string | null; status: string; plan: string | null; customerId?: string } | undefined;
const createSession = vi.fn(async (_params: Record<string, unknown>) => ({
  url: "https://checkout.stripe.com/c/test",
}));
const retrieveSub = vi.fn();
const updateSub = vi.fn(async () => ({}));
const createProduct = vi.fn();
const redirects: string[] = [];
const audit = vi.fn(async () => {});

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    redirects.push(url);
  },
}));
vi.mock("@/lib/auth-guard", () => ({
  requireClientOwner: async () =>
    owner ? { ok: true, user: { id: "u1", orgId: "o1" } } : { ok: false, error: "Only the owner can do that." },
  requireOperator: async () => ({ id: "op1", orgId: "o1" }),
}));
vi.mock("@/lib/data/clients", () => ({
  assertClientInOrg: async () => {},
  getClient: async () => ({ id: "c1", ownerEmail: "owner@example.com" }),
}));
vi.mock("@/lib/data/audit", () => ({ audit: () => audit() }));
vi.mock("@/lib/data/trial", () => ({
  getTrialState: async () => trialState,
}));
vi.mock("@/lib/env", () => ({
  env: { APP_URL: "https://frontdeskai.company" },
  integrations: { stripe: () => true },
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/stripe-prices", async (orig) => {
  const actual = await orig<typeof import("@/lib/stripe-prices")>();
  return { ...actual, verifiedStripePriceId: vi.fn(async () => "price_starter_monthly") };
});
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    checkout: { sessions: { create: createSession } },
    subscriptions: { retrieve: retrieveSub, update: updateSub },
    products: { create: createProduct },
  }),
}));
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: async () => (subRow ? [subRow] : []) }),
          limit: async () => (subRow ? [subRow] : []),
        }),
      }),
    }),
  },
}));

const { startSelfServeCheckoutAction, startCheckoutAction, changePlanAction } = await import("./billing");

const midTrial = {
  active: true,
  expired: false,
  daysLeft: 13,
  endsAt: new Date("2026-12-11T00:00:00Z"),
  comped: false,
  subscribed: false,
};
const expired = {
  active: false,
  expired: true,
  daysLeft: 0,
  endsAt: new Date("2026-11-20T00:00:00Z"),
  comped: false,
  subscribed: false,
};
const none = {
  active: false,
  expired: false,
  daysLeft: 0,
  endsAt: null as Date | null,
  comped: false,
  subscribed: false,
};

function form(extra: Record<string, string> = {}) {
  const f = new FormData();
  f.set("clientId", "c1");
  f.set("plan", "starter");
  f.set("interval", "month");
  for (const [k, v] of Object.entries(extra)) f.set(k, v);
  return f;
}

function expectNoStripeTrial(params: Record<string, unknown>) {
  expect(params).not.toHaveProperty("trial_end");
  expect(params).not.toHaveProperty("trial_period_days");
  const sub = params.subscription_data as Record<string, unknown> | undefined;
  expect(sub).toBeTruthy();
  expect(sub).not.toHaveProperty("trial_end");
  expect(sub).not.toHaveProperty("trial_period_days");
}

function lastUpdate(): { id: string; params: Record<string, unknown> } {
  expect(updateSub.mock.calls.length).toBeGreaterThan(0);
  const [id, params] = updateSub.mock.calls[0] as unknown as [string, Record<string, unknown>];
  return { id, params };
}

beforeEach(() => {
  owner = true;
  trialState = { ...midTrial };
  subRow = undefined;
  createSession.mockClear();
  createSession.mockImplementation(async () => ({ url: "https://checkout.stripe.com/c/test" }));
  retrieveSub.mockReset();
  updateSub.mockReset();
  updateSub.mockImplementation(async () => ({}));
  createProduct.mockReset();
  redirects.length = 0;
  audit.mockClear();
});

describe("startSelfServeCheckoutAction", () => {
  it("Buy now during an in-app trial opens Checkout with no Stripe trial (charge today)", async () => {
    const r = await startSelfServeCheckoutAction({ ok: false }, form());
    expect(r).toBeUndefined();
    expect(createSession).toHaveBeenCalledTimes(1);
    const params = createSession.mock.calls[0]![0] as Record<string, unknown>;
    expectNoStripeTrial(params);
    expect(params.mode).toBe("subscription");
    expect(redirects).toEqual(["https://checkout.stripe.com/c/test"]);
  });

  it("checkout after the trial has ended has no trial days", async () => {
    trialState = { ...expired };
    await startSelfServeCheckoutAction({ ok: false }, form());
    expectNoStripeTrial(createSession.mock.calls[0]![0] as Record<string, unknown>);
  });

  it("checkout on a messages-only / billing-hold business has no trial days", async () => {
    // Hold is an ended trial that hasn't paid; same checkout path, no Stripe trial.
    trialState = { ...expired };
    await startSelfServeCheckoutAction({ ok: false }, form());
    expectNoStripeTrial(createSession.mock.calls[0]![0] as Record<string, unknown>);
  });

  it("re-subscribe after cancel (no in-app trial left) has no trial days", async () => {
    trialState = { ...none };
    await startSelfServeCheckoutAction({ ok: false }, form());
    expectNoStripeTrial(createSession.mock.calls[0]![0] as Record<string, unknown>);
  });

  it("does not open a second checkout once the business is already subscribed", async () => {
    trialState = { ...none, subscribed: true };
    const r = await startSelfServeCheckoutAction({ ok: false }, form());
    expect(r).toMatchObject({ ok: false });
    expect(String((r as { error?: string }).error)).toMatch(/already on a plan/);
    expect(createSession).not.toHaveBeenCalled();
  });
});

describe("startCheckoutAction (operator)", () => {
  it("never attaches a Stripe trial", async () => {
    await startCheckoutAction({ ok: false }, form());
    expect(createSession).toHaveBeenCalledTimes(1);
    expectNoStripeTrial(createSession.mock.calls[0]![0] as Record<string, unknown>);
    expect(redirects).toEqual(["https://checkout.stripe.com/c/test"]);
  });
});

describe("changePlanAction", () => {
  it("prorates the plan change and does not attach or extend a trial", async () => {
    subRow = { subId: "sub_1", status: "active", plan: "starter" };
    retrieveSub.mockResolvedValue({
      id: "sub_1",
      metadata: { clientId: "c1", plan: "starter" },
      items: {
        data: [{ id: "si_1", price: { recurring: { interval: "month" } } }],
      },
    });
    const r = await changePlanAction({ ok: false }, form({ plan: "pro" }));
    expect(r.ok).toBe(true);
    expect(updateSub).toHaveBeenCalledTimes(1);
    const { id, params } = lastUpdate();
    expect(id).toBe("sub_1");
    expect(params.proration_behavior).toBe("create_prorations");
    expect(params).not.toHaveProperty("trial_end");
    expect(params).not.toHaveProperty("trial_period_days");
    expect(params.items).toEqual([{ id: "si_1", price: "price_starter_monthly" }]);
  });

  it("a leftover Stripe-trialing subscription can change plans without adding trial days", async () => {
    subRow = { subId: "sub_1", status: "trialing", plan: "starter" };
    retrieveSub.mockResolvedValue({
      id: "sub_1",
      metadata: { clientId: "c1", plan: "starter" },
      items: {
        data: [{ id: "si_1", price: { recurring: { interval: "month" } } }],
      },
    });
    const r = await changePlanAction({ ok: false }, form({ plan: "pro" }));
    expect(r.ok).toBe(true);
    const { params } = lastUpdate();
    expect(params.proration_behavior).toBe("create_prorations");
    expect(params).not.toHaveProperty("trial_end");
    expect(params).not.toHaveProperty("trial_period_days");
  });
});
