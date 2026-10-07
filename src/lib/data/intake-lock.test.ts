import { beforeEach, describe, expect, it, vi } from "vitest";

/** The intake link locks once someone from the business has signed in. */

vi.mock("@/db", async () => (await import("../../../test/helpers/pglite-db")).pgliteDb());

const { db } = await import("@/db");
const schema = await import("@/db/schema");
const { ownerHasSignedIn } = await import("./intake");

async function seed() {
  const [org] = await db.insert(schema.organizations).values({ name: "House", kind: "agency" }).returning();
  const [c] = await db.insert(schema.clients).values({ orgId: org!.id, name: "Biz", timezone: "America/New_York" }).returning();
  return { orgId: org!.id, clientId: c!.id };
}

beforeEach(async () => {
  await db.delete(schema.users);
  await db.delete(schema.clients);
  await db.delete(schema.organizations);
});

describe("ownerHasSignedIn", () => {
  it("is false until the owner's portal account exists", async () => {
    const { clientId } = await seed();
    expect(await ownerHasSignedIn(clientId)).toBe(false);
  });

  it("is true once the owner (or an invited teammate) has signed in", async () => {
    const { orgId, clientId } = await seed();
    await db.insert(schema.users).values({ orgId, clerkUserId: "u1", email: "o@biz.test", role: "client_admin", clientId });
    expect(await ownerHasSignedIn(clientId)).toBe(true);
  });

  it("an operator in the same org doesn't count — they send the link", async () => {
    const { orgId, clientId } = await seed();
    await db.insert(schema.users).values({ orgId, clerkUserId: "op", email: "ari@test", role: "operator" });
    expect(await ownerHasSignedIn(clientId)).toBe(false);
  });

  it("a deleted account doesn't hold the lock", async () => {
    const { orgId, clientId } = await seed();
    await db
      .insert(schema.users)
      .values({ orgId, clerkUserId: "gone", email: "o@biz.test", role: "client_admin", clientId, deletedAt: new Date() });
    expect(await ownerHasSignedIn(clientId)).toBe(false);
  });

  it("only locks that business", async () => {
    const a = await seed();
    const b = await seed();
    await db.insert(schema.users).values({ orgId: a.orgId, clerkUserId: "u1", email: "o@a.test", role: "client_admin", clientId: a.clientId });
    expect(await ownerHasSignedIn(a.clientId)).toBe(true);
    expect(await ownerHasSignedIn(b.clientId)).toBe(false);
  });
});
