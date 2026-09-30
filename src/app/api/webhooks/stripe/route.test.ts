import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Stripe webhook's retry contract: a failed handler must leave the event
 * re-processable, and only a handled event may short-circuit a replay.
 */

const ledger = new Map<string, string>();
const upserted: string[] = [];
let failUpsert = false;

vi.mock("@/lib/env", () => ({ env: { STRIPE_WEBHOOK_SECRET: "whsec_test" } }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/db", () => ({
  db: {
    insert: () => ({
      values: (v: { clientId: string }) => ({
        onConflictDoUpdate: async () => {
          if (failUpsert) throw new Error("db blip");
          upserted.push(v.clientId);
        },
      }),
    }),
  },
}));
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    webhooks: { constructEvent: (body: string) => JSON.parse(body) },
    subscriptions: { retrieve: vi.fn() },
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

function stripeEvent(id: string) {
  return new Request("https://example.test/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": "t=1,v1=sig" },
    body: JSON.stringify({
      id,
      type: "customer.subscription.updated",
      data: {
        object: { id: "sub_1", customer: "cus_1", status: "active", metadata: { clientId: "client-1" } },
      },
    }),
  });
}

describe("stripe webhook retries", () => {
  beforeEach(() => {
    ledger.clear();
    upserted.length = 0;
    failUpsert = false;
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
});
