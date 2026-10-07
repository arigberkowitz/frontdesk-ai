import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The Overview's lighter queries against a real in-process Postgres (PGlite):
 * the slim call/appointment lists return only what the page reads, newest
 * first, tenant-scoped and capped; getClientMetrics (now run concurrently)
 * still applies the revenue rule — earned only once it happened, real prices,
 * cancelled/no-show and deleted excluded.
 */

vi.mock("@/db", async () => (await import("../../../test/helpers/pglite-db")).pgliteDb());

const { db } = await import("@/db");
const s = await import("@/db/schema");
const { listRecentCallTimes } = await import("./calls");
const { listAppointmentTimes } = await import("./appointments");
const { getClientMetrics } = await import("./metrics");

const H = 3_600_000;
const at = (h: number) => new Date(Date.now() + h * H);
let clientId: string;

beforeAll(async () => {
  const [org] = await db.insert(s.organizations).values({ name: "Biz", kind: "business" }).returning();
  const [c] = await db.insert(s.clients).values({ orgId: org.id, name: "Bright", timezone: "America/New_York" }).returning();
  const [other] = await db.insert(s.clients).values({ orgId: org.id, name: "Other" }).returning();
  clientId = c.id;
  const [clean] = await db.insert(s.services).values({ clientId, name: "Cleaning", priceCents: 12_000 }).returning();
  const [crown] = await db.insert(s.services).values({ clientId, name: "Crown", priceCents: 90_000 }).returning();

  await db.insert(s.calls).values([
    { clientId, startAt: at(-1), isAfterHours: true, outcome: "booked", transcript: "long transcript…" },
    { clientId, startAt: at(-5), outcome: "missed" },
    { clientId, startAt: at(-30), outcome: "escalated" },
    { clientId, startAt: at(-2), deletedAt: new Date() },
    { clientId: other.id, startAt: at(-1) },
  ]);
  await db.insert(s.appointments).values([
    { clientId, serviceId: clean.id, startAt: at(-48), customerName: "Ana" }, // earned $120
    { clientId, serviceId: crown.id, startAt: at(-24), customerName: "Ben", status: "confirmed" }, // earned $900
    { clientId, serviceId: crown.id, startAt: at(24), customerName: "Cy" }, // upcoming $900
    { clientId, serviceId: crown.id, startAt: at(-24), status: "cancelled" },
    { clientId, serviceId: crown.id, startAt: at(-24), status: "no_show" },
    { clientId, serviceId: crown.id, startAt: at(-24), deletedAt: new Date() },
    { clientId: other.id, startAt: at(-24) },
  ]);
});

describe("listRecentCallTimes", () => {
  it("returns only when/after-hours, newest first, scoped, not deleted", async () => {
    const rows = await listRecentCallTimes(clientId);
    expect(rows).toHaveLength(3);
    expect(Object.keys(rows[0]).sort()).toEqual(["id", "isAfterHours", "startAt"]);
    expect(rows.map((r) => r.isAfterHours)).toEqual([true, false, false]);
    expect(rows[0].startAt!.getTime()).toBeGreaterThan(rows[1].startAt!.getTime());
    expect(await listRecentCallTimes(clientId, 1)).toHaveLength(1);
  });
});

describe("listAppointmentTimes", () => {
  it("returns time/status/name only, newest first, capped, not deleted", async () => {
    const rows = await listAppointmentTimes(clientId);
    expect(rows).toHaveLength(5); // deleted + other business excluded
    expect(Object.keys(rows[0]).sort()).toEqual(["customerName", "id", "startAt", "status"]);
    expect(rows[0].customerName).toBe("Cy");
    expect(await listAppointmentTimes(clientId, 2)).toHaveLength(2);
  });
});

describe("getClientMetrics", () => {
  it("keeps the revenue rule and call counts", async () => {
    const m = await getClientMetrics(clientId);
    expect(m.totalCalls).toBe(3);
    expect(m.afterHoursCalls).toBe(1);
    expect(m.missed).toBe(1);
    expect(m.escalated).toBe(1);
    expect(m.answerRate).toBeCloseTo(2 / 3);
    expect(m.bookings).toBe(3);
    expect(m.completedBookings).toBe(2);
    expect(m.estRevenueCents).toBe(102_000);
    expect(m.upcomingBookings).toBe(1);
    expect(m.upcomingRevenueCents).toBe(90_000);
    expect(m.avgServicePriceCents).toBe(51_000);
    expect(m.callsByDay).toHaveLength(14);
    expect(m.callsByDay.reduce((n, d) => n + d.revenueCents, 0)).toBe(102_000);
    expect(m.outcomes.reduce((n, o) => n + o.count, 0)).toBe(3);
  });

  it("a business with nothing yet gets zeros and null rates, not made-up numbers", async () => {
    const [org] = await db.insert(s.organizations).values({ name: "New", kind: "business" }).returning();
    const [c] = await db.insert(s.clients).values({ orgId: org.id, name: "Fresh" }).returning();
    const m = await getClientMetrics(c.id);
    expect(m.totalCalls).toBe(0);
    expect(m.answerRate).toBeNull();
    expect(m.estRevenueCents).toBe(0);
    expect(m.avgServicePriceCents).toBeNull();
  });
});
