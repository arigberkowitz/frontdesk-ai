import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Stripe webhook's retry contract: a failed handler must leave the event
 * re-processable, and only a handled event may short-circuit a replay.
 */

const ledger = new Map<string, string>();
const upserted: string[] = [];
const upsertedValues: Record<string, unknown>[] = [];
let failUpsert = false;
let storedClient: Record<string, unknown> | null = null;
let previousPlan: string | null = null;
const clientUpdates: Record<string, unknown>[] = [];
const syncAgentPrompt = vi.fn(async (_o: string, _c: string) => true);

const afterTasks: (() => Promise<unknown>)[] = [];
const provisionNumberAfterPayment = vi.fn(async (_id: string) => {});
const recordFirstPayment = vi.fn(async (_id: string, _amount: number | null | undefined) => true);

vi.mock("next/server", () => ({ after: (fn: () => Promise<unknown>) => afterTasks.push(fn) }));
vi.mock("@/lib/provision", () => ({
  provisionNumberAfterPayment: (id: string) => provisionNumberAfterPayment(id),
}));
vi.mock("@/lib/data/subscription-payment", () => ({
  recordFirstPayment: (id: string, amount: number | null | undefined) => recordFirstPayment(id, amount),
  isRealPayment: (amount: number | null | undefined) => (amount ?? 0) > 0,
}));
vi.mock("@/lib/env", () => ({ env: { STRIPE_WEBHOOK_SECRET: "whsec_test" } }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/db", () => ({
  db: {
    insert: () => ({
      values: (v: { clientId: string }) => ({
        onConflictDoUpdate: async () => {
          if (failUpsert) throw new Error("db blip");
          upserted.push(v.clientId);
          upsertedValues.push(v);
        },
      }),
    }),
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => (previousPlan ? [{ plan: previousPlan }] : []) }) }),
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: async () => {
          clientUpdates.push(v);
        },
      }),
    }),
    query: { clients: { findFirst: async () => storedClient } },
  },
}));
vi.mock("@/lib/agent-publish", () => ({ syncAgentPrompt: (o: string, c: string) => syncAgentPrompt(o, c) }));
const { retrieveSubscription } = vi.hoisted(() => ({
  retrieveSubscription: vi.fn(async (id: string) => ({
    id,
    customer: "cus_1",
    status: "active",
    metadata: { clientId: "client-1" },
    items: { data: [] },
  })),
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    webhooks: { constructEvent: (body: string) => JSON.parse(body) },
    subscriptions: { retrieve: (id: string) => retrieveSubscription(id) },
  }),
  subscriptionPeriodEnd: () => null,
}));
vi.mock("@/lib/data/webhook-events", () => ({
  recordWebhookEvent: async ({ externalId }: { externalId: string }) => {
    if (ledger.has(externalId)) return { isNew: false };
    ledger.set(externalId, "received");
    return { isNew: true };
  },
  getWebhookEventStatus: async (_s: string, id: string) => ledger.get(id) ?? null,
  markWebhookProcessed: async (_s: string, id: string, status = "processed") => {
    ledger.set(id, status);
  },
}));

const { POST } = await import("./route");

function stripeEvent(
  id: string,
  status = "active",
  plan?: string,
  price?: { unit_amount: number; recurring: { interval: string } },
) {
  return new Request("https://example.test/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": "t=1,v1=sig" },
    body: JSON.stringify({
      id,
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_1",
          customer: "cus_1",
          status,
          metadata: { clientId: "client-1", ...(plan ? { plan } : {}) },
          ...(price ? { items: { data: [{ price: { id: "price_x", ...price } }] } } : {}),
        },
      },
    }),
  });
}

function invoicePaidEvent(id: string, amountPaid = 14900, type = "invoice.paid") {
  return new Request("https://example.test/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": "t=1,v1=sig" },
    body: JSON.stringify({
      id,
      type,
      data: {
        object: {
          id: "in_1",
          amount_paid: amountPaid,
          customer: "cus_1",
          parent: {
            subscription_details: { subscription: "sub_1", metadata: { clientId: "client-1" } },
          },
        },
      },
    }),
  });
}

function checkoutEvent(id: string, amountTotal: number | null = 14900) {
  return new Request("https://example.test/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": "t=1,v1=sig" },
    body: JSON.stringify({
      id,
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_1",
          amount_total: amountTotal,
          subscription: "sub_1",
          metadata: { clientId: "client-1" },
        },
      },
    }),
  });
}

describe("stripe webhook retries", () => {
  beforeEach(() => {
    ledger.clear();
    upserted.length = 0;
    upsertedValues.length = 0;
    failUpsert = false;
    afterTasks.length = 0;
    provisionNumberAfterPayment.mockClear();
    recordFirstPayment.mockClear();
    retrieveSubscription.mockClear();
    storedClient = null;
    previousPlan = null;
    clientUpdates.length = 0;
    syncAgentPrompt.mockClear();
  });

  it("records what the subscription charges, so an earlier price stays put", async () => {
    await POST(stripeEvent("evt_px1", "active", "backup", { unit_amount: 14_900, recurring: { interval: "month" } }));
    expect(upsertedValues[0]).toMatchObject({ plan: "backup", monthlyPriceCents: 14_900 });
    await POST(stripeEvent("evt_px2", "active", "starter", { unit_amount: 300_000, recurring: { interval: "year" } }));
    expect(upsertedValues[1]).toMatchObject({ plan: "starter", monthlyPriceCents: 30_000 });
    // No price on the event: fall back to today's list price.
    await POST(stripeEvent("evt_px3", "active", "pro"));
    expect(upsertedValues[2]).toMatchObject({ plan: "pro", monthlyPriceCents: 59_900 });
  });

  it("processes a new event and marks it processed", async () => {
    const res = await POST(stripeEvent("evt_1"));
    expect(res.status).toBe(200);
    expect(upserted).toEqual(["client-1"]);
    expect(ledger.get("evt_1")).toBe("processed");
  });

  it("short-circuits a replay of an event that was handled", async () => {
    await POST(stripeEvent("evt_2"));
    const res = await POST(stripeEvent("evt_2"));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("already processed");
    expect(upserted).toHaveLength(1);
  });

  it("returns 500 on failure and lets Stripe's retry process the event", async () => {
    failUpsert = true;
    const first = await POST(stripeEvent("evt_3"));
    expect(first.status).toBe(500);
    expect(ledger.get("evt_3")).toBe("failed");

    failUpsert = false;
    const retry = await POST(stripeEvent("evt_3"));
    expect(retry.status).toBe(200);
    expect(await retry.text()).toBe("ok");
    expect(upserted).toEqual(["client-1"]);
    expect(ledger.get("evt_3")).toBe("processed");
  });

  it("reprocesses an event left at 'received' (e.g. the function crashed mid-flight)", async () => {
    ledger.set("evt_4", "received");
    const res = await POST(stripeEvent("evt_4"));
    expect(res.status).toBe(200);
    expect(upserted).toEqual(["client-1"]);
  });

  it("a card on file unlocks the reserved phone number — after the response", async () => {
    const res = await POST(stripeEvent("evt_5", "active"));
    expect(res.status).toBe(200);
    // Scheduled, not awaited inside the request.
    expect(provisionNumberAfterPayment).not.toHaveBeenCalled();
    expect(afterTasks).toHaveLength(1);
    await afterTasks[0]!();
    expect(provisionNumberAfterPayment).toHaveBeenCalledWith("client-1");
  });

  it("an unpaid or failed subscription never buys a number", async () => {
    for (const [i, status] of ["incomplete", "past_due", "canceled", "unpaid"].entries()) {
      await POST(stripeEvent(`evt_np_${i}`, status));
    }
    expect(afterTasks).toHaveLength(0);
    expect(provisionNumberAfterPayment).not.toHaveBeenCalled();
  });

  it("a Stripe trial (card saved, nothing charged yet) doesn't buy a number", async () => {
    await POST(stripeEvent("evt_trialing", "trialing"));
    expect(afterTasks).toHaveLength(0);
    expect(provisionNumberAfterPayment).not.toHaveBeenCalled();
  });

  it("no invoice event at all: the subscription turning active still buys the number", async () => {
    // Trial converts; Stripe only tells us via customer.subscription.updated.
    await POST(stripeEvent("evt_trial_start", "trialing"));
    await POST(stripeEvent("evt_trial_converted", "active"));
    expect(afterTasks).toHaveLength(1);
    await afterTasks[0]!();
    expect(provisionNumberAfterPayment).toHaveBeenCalledTimes(1);
    expect(provisionNumberAfterPayment).toHaveBeenCalledWith("client-1");
  });

  it("paying after a lapsed trial switches the business back on and clears the lapse markers", async () => {
    storedClient = {
      id: "client-1",
      orgId: "org-1",
      status: "paused",
      setupFlags: { trialLapsedAt: "2026-10-19T12:45:00.000Z", trialHoldAt: "2026-10-16T12:45:00.000Z" },
      answeringMode: "all_calls",
      staffModeEnabled: true,
      languages: "en",
    };
    await POST(stripeEvent("evt_lapsed_pays", "active", "starter"));
    expect(clientUpdates).toHaveLength(1);
    expect(clientUpdates[0]).toMatchObject({ status: "live", trialEndsAt: null });
    expect(clientUpdates[0]).toHaveProperty("setupFlags"); // SQL: drops trialLapsedAt / trialHoldAt
    for (const t of afterTasks) await t();
    expect(syncAgentPrompt).toHaveBeenCalledWith("org-1", "client-1"); // full agent back
    expect(provisionNumberAfterPayment).toHaveBeenCalledWith("client-1"); // a new number
  });

  it("an owner's own pause is not undone by a plan change", async () => {
    storedClient = {
      id: "client-1",
      orgId: "org-1",
      status: "paused",
      setupFlags: {},
      answeringMode: "all_calls",
      staffModeEnabled: true,
      languages: "en",
    };
    await POST(stripeEvent("evt_owner_paused", "active", "starter"));
    for (const u of clientUpdates) expect(u).not.toHaveProperty("status");
  });

  it("a held trial that pays goes live without touching other flags", async () => {
    storedClient = {
      id: "client-1",
      orgId: "org-1",
      status: "trial",
      setupFlags: { trialHoldAt: "2026-10-16T12:45:00.000Z" },
      answeringMode: "all_calls",
      staffModeEnabled: true,
      languages: "en",
    };
    await POST(stripeEvent("evt_held_pays", "active", "pro"));
    expect(clientUpdates[0]).toMatchObject({ status: "live" });
    expect(clientUpdates[0]).toHaveProperty("setupFlags");
  });

  it("a replayed paid event doesn't schedule a second purchase", async () => {
    await POST(stripeEvent("evt_6", "active"));
    await POST(stripeEvent("evt_6", "active"));
    expect(afterTasks).toHaveLength(1);
  });

  it("a paid Rescue purchase makes the business live, missed-only, no staff mode, and republishes the agent", async () => {
    storedClient = {
      id: "client-1",
      orgId: "org-1",
      status: "trial",
      setupFlags: {},
      answeringMode: "all_calls",
      staffModeEnabled: true,
      languages: "en",
    };
    const res = await POST(stripeEvent("evt_rescue", "active", "backup"));
    expect(res.status).toBe(200);
    expect(clientUpdates).toEqual([
      { status: "live", trialEndsAt: null, answeringMode: "missed_only", staffModeEnabled: false, languages: "en-es" },
    ]);
    for (const t of afterTasks) await t();
    expect(syncAgentPrompt).toHaveBeenCalledWith("org-1", "client-1");
  });

  it("a paid Pro purchase goes live with Spanish and keeps staff mode", async () => {
    storedClient = {
      id: "client-1",
      orgId: "org-1",
      status: "trial",
      setupFlags: {},
      answeringMode: "all_calls",
      staffModeEnabled: true,
      languages: "en",
    };
    await POST(stripeEvent("evt_pro", "active", "pro"));
    expect(clientUpdates).toEqual([{ status: "live", trialEndsAt: null, languages: "en-es" }]);
  });

  it("invoice.paid after a trial converts upserts the subscription and unlocks the number once", async () => {
    const res = await POST(invoicePaidEvent("evt_inv_1"));
    expect(res.status).toBe(200);
    expect(retrieveSubscription).toHaveBeenCalledWith("sub_1");
    expect(upserted).toEqual(["client-1"]);
    expect(recordFirstPayment).toHaveBeenCalledWith("client-1", 14900);
    expect(provisionNumberAfterPayment).not.toHaveBeenCalled();
    expect(afterTasks).toHaveLength(1);
    await afterTasks[0]!();
    expect(provisionNumberAfterPayment).toHaveBeenCalledWith("client-1");
  });

  it("a replayed invoice.paid event doesn't schedule a second purchase", async () => {
    await POST(invoicePaidEvent("evt_inv_2"));
    await POST(invoicePaidEvent("evt_inv_2"));
    expect(afterTasks).toHaveLength(1);
    expect(upserted).toHaveLength(1);
    expect(recordFirstPayment).toHaveBeenCalledTimes(1);
    expect(recordFirstPayment).toHaveBeenCalledWith("client-1", 14900);
  });

  it("invoice.paid with a $0 100%-off invoice records no real payment", async () => {
    const res = await POST(invoicePaidEvent("evt_inv_zero", 0));
    expect(res.status).toBe(200);
    expect(upserted).toEqual(["client-1"]);
    expect(recordFirstPayment).toHaveBeenCalledWith("client-1", 0);
  });

  it("invoice.payment_succeeded with a real amount records the payment and unlocks once", async () => {
    const res = await POST(invoicePaidEvent("evt_inv_suc", 14900, "invoice.payment_succeeded"));
    expect(res.status).toBe(200);
    expect(recordFirstPayment).toHaveBeenCalledWith("client-1", 14900);
    expect(afterTasks).toHaveLength(1);
    await afterTasks[0]!();
    expect(provisionNumberAfterPayment).toHaveBeenCalledWith("client-1");
  });

  it("checkout.session.completed records a real payment from amount_total, but not a $0 promo checkout", async () => {
    await POST(checkoutEvent("evt_cs_paid", 14900));
    expect(recordFirstPayment).toHaveBeenCalledWith("client-1", 14900);
    recordFirstPayment.mockClear();
    await POST(checkoutEvent("evt_cs_free", 0));
    expect(recordFirstPayment).toHaveBeenCalledWith("client-1", 0);
  });
});
