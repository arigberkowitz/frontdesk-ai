import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * One signup, one business, one phone number — against a real (in-process)
 * Postgres with the full schema, so the atomic UPDATEs are what's tested.
 *
 *  - attachCreatorToClient: a second submit from the same account (the other
 *    button, a double-click, a replayed POST) loses the claim, and the business
 *    it created is discarded before any drafting or provisioning.
 *  - claimFirstProvision: two concurrent first provisions can't both proceed
 *    to buy a number.
 */

vi.mock("@/db", async () => (await import("../../test/helpers/pglite-db")).pgliteDb());
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: null }), currentUser: async () => null }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error(`redirect:${u}`); } }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { db } = await import("@/db");
const schema = await import("@/db/schema");
const { attachCreatorToClient } = await import("./auth-guard");
const { claimFirstProvision, releaseFirstProvision } = await import("./provision-lock");
const { eq } = await import("drizzle-orm");

async function seed(role: "client_admin" | "operator") {
  const [org] = await db.insert(schema.organizations).values({ name: "House", kind: "agency" }).returning();
  const [user] = await db
    .insert(schema.users)
    .values({ orgId: org.id, clerkUserId: `clerk_${role}_${Math.random()}`, email: "owner@newbiz.test", role })
    .returning();
  const mk = async (name: string) =>
    (await db.insert(schema.clients).values({ orgId: org.id, name, timezone: "America/New_York" }).returning())[0];
  return { org, user, mk };
}

beforeEach(async () => {
  await db.delete(schema.alertContacts);
  await db.delete(schema.users);
  await db.delete(schema.clients);
  await db.delete(schema.organizations);
});

describe("attachCreatorToClient (signup claim)", () => {
  it("binds the first business and discards a second one from the same signup", async () => {
    const { user, mk } = await seed("client_admin");
    const a = await mk("First");
    const b = await mk("Second");

    // Both requests passed requireBusinessCreator with the same stale user row.
    const [first, second] = await Promise.all([attachCreatorToClient(user, a.id), attachCreatorToClient(user, b.id)]);
    expect([first, second].filter(Boolean)).toHaveLength(1);

    const winner = first ? a : b;
    const loser = first ? b : a;
    const row = await db.query.users.findFirst({ where: eq(schema.users.id, user.id) });
    expect(row?.clientId).toBe(winner.id);
    const lost = await db.query.clients.findFirst({ where: eq(schema.clients.id, loser.id) });
    expect(lost?.deletedAt).toBeInstanceOf(Date);
    const kept = await db.query.clients.findFirst({ where: eq(schema.clients.id, winner.id) });
    expect(kept?.deletedAt).toBeNull();
    expect(kept?.ownerEmail).toBe("owner@newbiz.test");
  });

  it("refuses once the account already has a business", async () => {
    const { user, mk } = await seed("client_admin");
    const a = await mk("First");
    expect(await attachCreatorToClient(user, a.id)).toBe(true);
    const later = await mk("Replayed POST");
    expect(await attachCreatorToClient(user, later.id)).toBe(false);
    const row = await db.query.clients.findFirst({ where: eq(schema.clients.id, later.id) });
    expect(row?.deletedAt).toBeInstanceOf(Date);
  });

  it("operators: only the workspace's first business passes the /welcome claim", async () => {
    const { user, mk } = await seed("operator");
    const a = await mk("First");
    await new Promise((r) => setTimeout(r, 5));
    const b = await mk("Second");
    expect(await attachCreatorToClient(user, a.id)).toBe(true);
    expect(await attachCreatorToClient(user, b.id)).toBe(false);
  });
});

describe("claimFirstProvision (one phone number per business)", () => {
  it("lets exactly one of two concurrent first provisions through, then frees the lock", async () => {
    const { mk } = await seed("client_admin");
    const c = await mk("Biz");
    const results = await Promise.all([claimFirstProvision(c.id), claimFirstProvision(c.id)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await claimFirstProvision(c.id)).toBe(false);

    await releaseFirstProvision(c.id);
    const row = await db.query.clients.findFirst({ where: eq(schema.clients.id, c.id) });
    expect(row?.setupFlags?.provisioningAt).toBeUndefined();
    expect(await claimFirstProvision(c.id)).toBe(true);
  });

  it("never claims for a business that already has its number", async () => {
    const { mk } = await seed("client_admin");
    const c = await mk("Biz");
    await db.update(schema.clients).set({ retellPhoneNumber: "+14155550100" }).where(eq(schema.clients.id, c.id));
    expect(await claimFirstProvision(c.id)).toBe(false);
  });

  it("treats a lock older than a few minutes as abandoned", async () => {
    const { mk } = await seed("client_admin");
    const c = await mk("Biz");
    const stale = new Date(Date.now() - 10 * 60_000).toISOString();
    await db.update(schema.clients).set({ setupFlags: { provisioningAt: stale, forwardingDone: true } }).where(eq(schema.clients.id, c.id));
    expect(await claimFirstProvision(c.id)).toBe(true);
    const row = await db.query.clients.findFirst({ where: eq(schema.clients.id, c.id) });
    // Other flags survive the lock write.
    expect(row?.setupFlags?.forwardingDone).toBe(true);
  });
});
