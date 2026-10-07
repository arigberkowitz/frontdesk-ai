import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The value card's month queries against a real in-process Postgres (PGlite)
 * with the full schema: earned vs upcoming, the business-timezone month
 * window, cancelled/no-show and spam exclusions, the "recovered" rule for
 * missed-call text-backs, and tenant scoping.
 */

vi.mock("@/db", async () => (await import("../../../test/helpers/pglite-db")).pgliteDb());

const { db } = await import("@/db");
const s = await import("@/db/schema");
const { getMonthValue } = await import("./month-value");

const TZ = "UTC";
const NOW = Date.now();
const d = new Date(NOW);
const monthStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
const monthEnd = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
/** Strictly inside [month start, now) and (now, month end). */
const past = (frac = 0.5) => new Date(monthStart + (NOW - monthStart) * frac);
const later = (frac = 0.5) => new Date(NOW + (monthEnd - NOW) * frac);
const lastMonth = new Date(monthStart - 86_400_000);

let clientId: string;
let otherId: string;

beforeAll(async () => {
  const [org] = await db.insert(s.organizations).values({ name: "Biz", kind: "business" }).returning();
  const [c] = await db.insert(s.clients).values({ orgId: org.id, name: "Bright", timezone: TZ }).returning();
  const [o] = await db.insert(s.clients).values({ orgId: org.id, name: "Other", timezone: TZ }).returning();
  clientId = c.id;
  otherId = o.id;
  const [cleaning, whitening, free] = await db
    .insert(s.services)
    .values([
      { clientId, name: "Cleaning", priceCents: 18000 },
      { clientId, name: "Whitening", priceCents: 45000 },
      { clientId, name: "Consult", priceCents: null },
    ])
    .returning();
  const appt = (extra: Partial<typeof s.appointments.$inferInsert>) => ({
    clientId,
    customerName: "X",
    startAt: past(),
    status: "booked" as const,
    ...extra,
  });
  await db.insert(s.appointments).values([
    appt({ serviceId: cleaning.id }), // earned $180
    appt({ serviceId: whitening.id, status: "confirmed" }), // earned $450
    appt({ serviceId: free.id }), // happened, unpriced
    appt({ serviceId: whitening.id, status: "cancelled" }), // excluded
    appt({ serviceId: whitening.id, status: "no_show" }), // excluded
    appt({ serviceId: cleaning.id, deletedAt: new Date() }), // excluded
    appt({ serviceId: whitening.id, startAt: lastMonth }), // last month
    appt({ serviceId: cleaning.id, startAt: later() }), // upcoming this month
    { clientId: otherId, customerName: "Y", startAt: past(), status: "booked" as const }, // other tenant
  ]);

  const [call1, call2, call3] = await db
    .insert(s.calls)
    .values([
      { clientId, startAt: past(0.2), isAfterHours: true, outcome: "booked", fromNumber: "+14155550001" },
      { clientId, startAt: past(0.3), isAfterHours: true, outcome: "spam", fromNumber: "+14155550002" },
      { clientId, startAt: past(0.4), isAfterHours: false, outcome: "lead", fromNumber: "+14155550003" },
      { clientId, startAt: lastMonth, isAfterHours: true, outcome: "booked" },
      { clientId: otherId, startAt: past(0.2), isAfterHours: true },
    ])
    .returning();

  // Three text-backs this month: one booked afterwards, one texted back, one silent.
  const sentAt = past(0.5);
  await db.insert(s.callCallbacks).values([
    { clientId, callId: call1.id, customerPhone: "14155550001", reason: "dropped", status: "sent", sentAt },
    { clientId, callId: call2.id, customerPhone: "14155550002", reason: "hung_up_early", status: "sent", sentAt },
    { clientId, callId: call3.id, customerPhone: "14155550003", reason: "hung_up_early", status: "sent", sentAt },
  ]);
  await db.insert(s.appointments).values({
    clientId,
    customerName: "Booked after text",
    customerPhone: "(415) 555-0001",
    startAt: later(0.9),
    status: "booked",
    createdAt: past(0.7),
  });
  await db.insert(s.smsMessages).values([
    { clientId, direction: "inbound", customerPhone: "14155550002", body: "yes pls", status: "received", kind: "reply", createdAt: past(0.8) },
    // STOP isn't a recovery.
    { clientId, direction: "inbound", customerPhone: "14155550003", body: "STOP", status: "received", kind: "opt_out", createdAt: past(0.8) },
    // AI texts: 2 sent across 2 conversations, 1 failed, 1 last month.
    { clientId, direction: "outbound", customerPhone: "14155550002", body: "a", status: "delivered", kind: "ai_reply", createdAt: past(0.85) },
    { clientId, direction: "outbound", customerPhone: "14155550009", body: "b", status: "sent", kind: "ai_reply", createdAt: past(0.9) },
    { clientId, direction: "outbound", customerPhone: "14155550009", body: "c", status: "failed", kind: "ai_reply", createdAt: past(0.9) },
    { clientId, direction: "outbound", customerPhone: "14155550009", body: "d", status: "sent", kind: "ai_reply", createdAt: lastMonth },
  ]);
});

describe("getMonthValue", () => {
  it("earned revenue = happened this month, at the booked service's price", async () => {
    const v = await getMonthValue(clientId, TZ);
    expect(v.revenue).toEqual({
      earnedCents: 18000 + 45000,
      completed: 3,
      unpriced: 1,
      // the upcoming cleaning + the appointment booked after the text-back (no service)
      upcomingCents: 18000,
      upcoming: 2,
    });
  });

  it("after-hours answered excludes spam and other months", async () => {
    const v = await getMonthValue(clientId, TZ);
    expect(v.calls).toEqual({ calls: 3, afterHours: 1 });
  });

  it("a text-back counts as recovered only if they booked, called or texted back (not STOP)", async () => {
    const v = await getMonthValue(clientId, TZ);
    expect(v.recovery).toEqual({ sent: 3, recovered: 2 });
  });

  it("AI texts this month, not failed", async () => {
    const v = await getMonthValue(clientId, TZ);
    expect(v.texts).toEqual({ aiTexts: 2, conversations: 2 });
  });

  it("is scoped to the business", async () => {
    const v = await getMonthValue(otherId, TZ);
    expect(v.revenue?.completed).toBe(1);
    expect(v.revenue?.earnedCents).toBe(0);
    expect(v.recovery).toEqual({ sent: 0, recovered: 0 });
    expect(v.texts).toEqual({ aiTexts: 0, conversations: 0 });
  });
});
