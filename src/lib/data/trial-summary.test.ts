import { beforeEach, describe, expect, it, vi } from "vitest";

/** The day-7 email's numbers come from real rows — and only the right ones. */

vi.mock("@/db", async () => (await import("../../../test/helpers/pglite-db")).pgliteDb());

const { db } = await import("@/db");
const schema = await import("@/db/schema");
const { getTrialSummaryStats } = await import("./trial-summary");

const DAY = 86_400_000;
let n = 0;

async function seedClient() {
  const [org] = await db.insert(schema.organizations).values({ name: "House", kind: "agency" }).returning();
  const [c] = await db
    .insert(schema.clients)
    .values({ orgId: org!.id, name: "Nick's", timezone: "America/New_York", status: "trial" })
    .returning();
  return c!;
}

async function call(clientId: string, daysAgo: number, extra: Partial<typeof schema.calls.$inferInsert> = {}) {
  const [row] = await db
    .insert(schema.calls)
    .values({
      clientId,
      retellCallId: `t${n++}`,
      toNumber: "+14155550123",
      startAt: new Date(Date.now() - daysAgo * DAY),
      ...extra,
    })
    .returning();
  return row!;
}

beforeEach(async () => {
  await db.delete(schema.leads);
  await db.delete(schema.appointments);
  await db.delete(schema.calls);
  await db.delete(schema.businessHours);
  await db.delete(schema.clients);
  await db.delete(schema.organizations);
});

describe("getTrialSummaryStats", () => {
  const since = () => new Date(Date.now() - 7 * DAY);

  it("counts answered customer calls only", async () => {
    const c = await seedClient();
    await call(c.id, 1);
    await call(c.id, 2, { isAfterHours: true });
    await call(c.id, 2, { outcome: "spam" });
    await call(c.id, 2, { outcome: "missed" });
    await call(c.id, 2, { toNumber: null }); // browser test call
    await call(c.id, 2, { direction: "outbound" }); // AI callback
    await call(c.id, 10); // before the trial
    const s = await getTrialSummaryStats(c.id, since());
    expect(s.calls).toBe(2);
  });

  it("after-hours is null without saved hours, a real count with them", async () => {
    const c = await seedClient();
    await call(c.id, 1, { isAfterHours: true });
    await call(c.id, 1);
    expect((await getTrialSummaryStats(c.id, since())).afterHours).toBeNull();
    await db.insert(schema.businessHours).values({ clientId: c.id, dayOfWeek: 1, openTime: "09:00", closeTime: "17:00" });
    expect((await getTrialSummaryStats(c.id, since())).afterHours).toBe(1);
  });

  it("bookings: on a call, still on the calendar; messages: leads in the window", async () => {
    const c = await seedClient();
    const k = await call(c.id, 1);
    const start = new Date(Date.now() + DAY);
    await db.insert(schema.appointments).values([
      { clientId: c.id, callId: k.id, startAt: start },
      { clientId: c.id, callId: k.id, startAt: start, status: "cancelled" },
      { clientId: c.id, startAt: start }, // typed in by hand
    ]);
    await db.insert(schema.leads).values([
      { clientId: c.id, callId: k.id, name: "A" },
      { clientId: c.id, name: "B", createdAt: new Date(Date.now() - 10 * DAY) },
    ]);
    const s = await getTrialSummaryStats(c.id, since());
    expect(s).toMatchObject({ booked: 1, messages: 1 });
  });

  it("scopes by client", async () => {
    const a = await seedClient();
    const b = await seedClient();
    await call(b.id, 1);
    expect((await getTrialSummaryStats(a.id, since())).calls).toBe(0);
  });
});
