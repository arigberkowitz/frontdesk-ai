import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db", async () => (await import("../../../test/helpers/pglite-db")).pgliteDb());

const { db } = await import("@/db");
const schema = await import("@/db/schema");
const { eq } = await import("drizzle-orm");
const { isRealPayment, recordFirstPayment } = await import("./subscription-payment");

describe("isRealPayment", () => {
  it("is true only for an amount over $0", () => {
    expect(isRealPayment(14900)).toBe(true);
    expect(isRealPayment(1)).toBe(true);
    expect(isRealPayment(0)).toBe(false);
    expect(isRealPayment(null)).toBe(false);
    expect(isRealPayment(undefined)).toBe(false);
  });
});

describe("recordFirstPayment", () => {
  beforeEach(async () => {
    await db.delete(schema.subscriptions);
    await db.delete(schema.clients);
    await db.delete(schema.organizations);
  });

  async function seedSub() {
    const [org] = await db.insert(schema.organizations).values({ name: "House", kind: "agency" }).returning();
    const [c] = await db
      .insert(schema.clients)
      .values({ orgId: org!.id, name: "Nick's Plumbing", timezone: "America/New_York", status: "trial" })
      .returning();
    await db.insert(schema.subscriptions).values({ clientId: c!.id, status: "active", plan: "starter" });
    return c!.id;
  }

  it("a $0 invoice does not set firstPaidAt", async () => {
    const clientId = await seedSub();
    expect(await recordFirstPayment(clientId, 0)).toBe(false);
    const row = await db.query.subscriptions.findFirst({ where: eq(schema.subscriptions.clientId, clientId) });
    expect(row?.firstPaidAt ?? null).toBeNull();
  });

  it("the first real payment sets firstPaidAt, and a later event leaves it alone", async () => {
    const clientId = await seedSub();
    expect(await recordFirstPayment(clientId, 14900)).toBe(true);
    const first = await db.query.subscriptions.findFirst({ where: eq(schema.subscriptions.clientId, clientId) });
    expect(first?.firstPaidAt).toBeInstanceOf(Date);
    const stamped = first!.firstPaidAt!;
    await new Promise((r) => setTimeout(r, 20));
    expect(await recordFirstPayment(clientId, 14900)).toBe(true);
    const again = await db.query.subscriptions.findFirst({ where: eq(schema.subscriptions.clientId, clientId) });
    expect(again?.firstPaidAt?.getTime()).toBe(stamped.getTime());
  });
});
