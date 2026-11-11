import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * When a toll-free texting number gets bought — against a real in-process
 * Postgres (PGlite) with the full schema, the real store and its atomic
 * claim. Only Twilio is faked; every purchase is counted.
 *
 * Rule: a number is bought only once setup is finished AND a subscription is
 * active/trialing AND the business has no texting number — and never twice,
 * however many Stripe webhooks / setup finishes arrive, even concurrently.
 */

vi.mock("@/db", async () => (await import("../../../test/helpers/pglite-db")).pgliteDb());

const { db } = await import("@/db");
const schema = await import("@/db/schema");
const { eq } = await import("drizzle-orm");
const { tollfreeStore, TOLLFREE_BUY_LOCK_MINUTES } = await import("@/lib/data/tollfree");
const { ensureTollfreeNumber } = await import("./service");
type Deps = import("./service").TollfreeDeps;

let purchases: string[];
let deps: Deps;

beforeEach(async () => {
  purchases = [];
  deps = {
    enabled: true,
    store: tollfreeStore,
    appUrl: "https://app.test",
    notificationEmail: "ops@app.test",
    api: {
      buyNumber: vi.fn(async (name: string) => {
        // Latency so concurrent calls genuinely overlap.
        await new Promise((r) => setTimeout(r, 20));
        purchases.push(name);
        return { phoneNumber: `+1888555${String(1000 + purchases.length).slice(-4)}`, sid: `PN${purchases.length}` };
      }),
      submit: vi.fn(),
      resubmit: vi.fn(),
      fetch: vi.fn(),
    } as unknown as Deps["api"],
  };
  await db.delete(schema.clientTollfree);
  await db.delete(schema.subscriptions);
  await db.delete(schema.clients);
  await db.delete(schema.organizations);
});

async function newClient(extra: Partial<typeof schema.clients.$inferInsert> = {}) {
  const [org] = await db.insert(schema.organizations).values({ name: "House", kind: "agency" }).returning();
  const [c] = await db
    .insert(schema.clients)
    .values({ orgId: org!.id, name: "Nick's Plumbing", timezone: "America/New_York", status: "trial", ...extra })
    .returning();
  return c!;
}
const pay = (clientId: string, status: "active" | "trialing" | "past_due" | "canceled" = "active") =>
  db.insert(schema.subscriptions).values({ clientId, status, plan: "starter" });
const finishSetup = (clientId: string) =>
  db.update(schema.clients).set({ setupCompletedAt: new Date() }).where(eq(schema.clients.id, clientId));
const tollfreeRow = (clientId: string) => tollfreeStore.get(clientId);

describe("toll-free number purchase gate", () => {
  it("payment before setup is finished buys nothing", async () => {
    const c = await newClient();
    await pay(c.id);
    await ensureTollfreeNumber(deps, c.id); // what the Stripe webhook runs
    await ensureTollfreeNumber(deps, c.id); // a replayed webhook
    expect(purchases).toHaveLength(0);
    expect((await tollfreeRow(c.id))?.phoneNumberSid ?? null).toBeNull();
  });

  it("setup finished but not paying (or past due / canceled) buys nothing", async () => {
    const c = await newClient();
    await finishSetup(c.id);
    await ensureTollfreeNumber(deps, c.id);
    await pay(c.id, "past_due");
    await ensureTollfreeNumber(deps, c.id);
    await db.update(schema.subscriptions).set({ status: "canceled" }).where(eq(schema.subscriptions.clientId, c.id));
    await ensureTollfreeNumber(deps, c.id);
    expect(purchases).toHaveLength(0);
  });

  it("paid first, then setup finishes: exactly one number", async () => {
    const c = await newClient();
    await pay(c.id);
    await ensureTollfreeNumber(deps, c.id); // payment webhook: too early
    await finishSetup(c.id);
    await ensureTollfreeNumber(deps, c.id); // "I'm done" on setup
    expect(purchases).toHaveLength(1);
    expect(await tollfreeRow(c.id)).toMatchObject({ status: "needs_details", phoneNumberSid: "PN1" });
    // The lock is released once the number is saved.
    const after = await db.query.clients.findFirst({ where: eq(schema.clients.id, c.id) });
    expect(after?.setupFlags?.tollfreeBuyingAt).toBeUndefined();
  });

  it("setup finished first, then payment (trialing counts): exactly one number", async () => {
    const c = await newClient();
    await finishSetup(c.id);
    await pay(c.id, "trialing");
    await ensureTollfreeNumber(deps, c.id);
    expect(purchases).toHaveLength(1);
  });

  it("repeat events still buy one number", async () => {
    const c = await newClient();
    await finishSetup(c.id);
    await pay(c.id);
    for (let i = 0; i < 5; i++) await ensureTollfreeNumber(deps, c.id);
    expect(purchases).toHaveLength(1);
  });

  it("concurrent webhooks + setup finish still buy one number", async () => {
    const c = await newClient();
    await finishSetup(c.id);
    await pay(c.id);
    await Promise.all(Array.from({ length: 8 }, () => ensureTollfreeNumber(deps, c.id)));
    expect(purchases).toHaveLength(1);
    expect((await tollfreeRow(c.id))?.phoneNumberSid).toBe("PN1");
  });

  it("a business that already has a texting number never gets another", async () => {
    const own = await newClient({ smsNumber: "+15125550100" });
    await finishSetup(own.id);
    await pay(own.id);
    await ensureTollfreeNumber(deps, own.id);

    const hasTollfree = await newClient();
    await finishSetup(hasTollfree.id);
    await pay(hasTollfree.id);
    await tollfreeStore.save(hasTollfree.id, { status: "submitted", phoneNumber: "+18885550000", phoneNumberSid: "PNold" });
    await ensureTollfreeNumber(deps, hasTollfree.id);
    // The DB claim alone refuses too (not just the service's early read).
    expect(await tollfreeStore.claimBuy(hasTollfree.id)).toBe(false);
    expect(await tollfreeStore.claimBuy(own.id)).toBe(false);
    expect(purchases).toHaveLength(0);
  });

  it("a failed buy releases the lock so a later event can retry; a stale lock expires", async () => {
    const c = await newClient();
    await finishSetup(c.id);
    await pay(c.id);
    (deps.api.buyNumber as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Twilio down"));
    await ensureTollfreeNumber(deps, c.id);
    expect((await tollfreeRow(c.id))?.lastError).toBe("Twilio down");
    expect(purchases).toHaveLength(0);

    // Someone else holds a fresh lock: no buy.
    expect(await tollfreeStore.claimBuy(c.id)).toBe(true);
    await ensureTollfreeNumber(deps, c.id);
    expect(purchases).toHaveLength(0);
    // Lock abandoned long ago: the next event can buy.
    const old = new Date(Date.now() - (TOLLFREE_BUY_LOCK_MINUTES + 1) * 60_000).toISOString();
    await db.update(schema.clients).set({ setupFlags: { tollfreeBuyingAt: old } }).where(eq(schema.clients.id, c.id));
    await ensureTollfreeNumber(deps, c.id);
    expect(purchases).toHaveLength(1);
  });

  it("flag off: nothing, even when eligible", async () => {
    const c = await newClient();
    await finishSetup(c.id);
    await pay(c.id);
    await ensureTollfreeNumber({ ...deps, enabled: false }, c.id);
    expect(purchases).toHaveLength(0);
  });
});
