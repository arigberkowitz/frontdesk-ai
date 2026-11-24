import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The morning "didn't book" query and per-day claim against a real in-process
 * Postgres (PGlite) with the full schema: after-hours only, the window edges,
 * bookings made later by phone number, tenant scoping, and once-a-day claims.
 */

vi.mock("@/db", async () => (await import("../../../test/helpers/pglite-db")).pgliteDb());
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { db } = await import("@/db");
const s = await import("@/db/schema");
const { claimMorningUnbooked, finishMorningUnbooked, getUnbookedAfterHoursCallers, lastMorningUnbookedSentAt } =
  await import("./morning-unbooked");
const { morningWindow } = await import("@/lib/morning-unbooked");

const TZ = "America/Los_Angeles";
const NOW = new Date("2026-09-30T16:00:00Z"); // 9am PDT
const W = morningWindow(NOW, TZ); // 2026-09-29 15:00Z → 2026-09-30 15:00Z
const t = (iso: string) => new Date(iso);

let clientId: string;
let otherId: string;

beforeAll(async () => {
  const [org] = await db.insert(s.organizations).values({ name: "Biz", kind: "business" }).returning();
  const [c] = await db.insert(s.clients).values({ orgId: org.id, name: "Ohana", timezone: TZ }).returning();
  const [o] = await db.insert(s.clients).values({ orgId: org.id, name: "Other", timezone: TZ }).returning();
  clientId = c.id;
  otherId = o.id;
  const call = (over: Partial<typeof s.calls.$inferInsert>) =>
    db.insert(s.calls).values({ clientId, isAfterHours: true, startAt: t("2026-09-30T05:00:00Z"), ...over }).returning();

  const [withLead] = await call({ fromNumber: "+14155550100", outcome: "lead", summary: "Wants a quote." });
  await db.insert(s.leads).values({ clientId, callId: withLead.id, name: "Maria Lopez", phone: "+14155550100", reason: "Water heater quote" });
  await call({ fromNumber: "+14155550101", outcome: "missed" }); // hung up → listed
  await call({ fromNumber: "+14155550102", outcome: "booked" }); // booked on the call
  await call({ fromNumber: "+14155550103", outcome: "spam" });
  await call({ fromNumber: "+14155550104", outcome: "faq_answered", isAfterHours: false }); // daytime
  await call({ fromNumber: "+14155550105", outcome: "lead", startAt: t("2026-09-29T14:00:00Z") }); // before window
  await call({ fromNumber: "+14155550106", outcome: "lead", startAt: t("2026-09-30T15:30:00Z") }); // after window edge
  await call({ fromNumber: "+14155550107", outcome: "lead", direction: "outbound" });
  await call({ fromNumber: "+14155550108", outcome: "lead" }); // booked later by text
  await db.insert(s.appointments).values({
    clientId,
    customerPhone: "(415) 555-0108",
    startAt: t("2026-10-02T17:00:00Z"),
    createdAt: t("2026-09-30T14:00:00Z"),
  });
  await call({ fromNumber: "+14155550109", outcome: "lead", deletedAt: t("2026-09-30T06:00:00Z") });
  await db.insert(s.calls).values({ clientId: otherId, isAfterHours: true, startAt: t("2026-09-30T05:00:00Z"), fromNumber: "+14155550110", outcome: "lead" });
});

describe("getUnbookedAfterHoursCallers", () => {
  it("lists only last night's after-hours callers who didn't book, for this business", async () => {
    const out = await getUnbookedAfterHoursCallers({ id: clientId, setupFlags: {} }, W);
    expect(out).not.toBeNull();
    const phones = out!.map((c) => c.phone).sort();
    expect(phones).toEqual(["+14155550100", "+14155550101"]);
    const maria = out!.find((c) => c.leadId);
    expect(maria).toMatchObject({ name: "Maria Lopez", wanted: "Water heater quote" });
  });

  it("drops blocked numbers", async () => {
    const out = await getUnbookedAfterHoursCallers({ id: clientId, setupFlags: { blockedNumbers: ["4155550101"] } }, W);
    expect(out!.map((c) => c.phone)).toEqual(["+14155550100"]);
  });
});

describe("claimMorningUnbooked", () => {
  it("claims once per business per day, lets a skipped/failed day retry, and tracks last sent", async () => {
    const a = await claimMorningUnbooked(clientId, "2026-09-30", "+14155559999");
    expect(a).toBeTruthy();
    expect(await claimMorningUnbooked(clientId, "2026-09-30", "+14155559999")).toBeNull();
    await finishMorningUnbooked(a!, { status: "skipped", dayKey: "2026-09-30", body: "x", recipients: [], callers: 1 });
    const b = await claimMorningUnbooked(clientId, "2026-09-30", "+14155559999");
    expect(b).toBeTruthy();
    expect(await lastMorningUnbookedSentAt(clientId)).toBeNull();
    await finishMorningUnbooked(b!, { status: "sent", dayKey: "2026-09-30", body: "x", recipients: ["+14155559999"], callers: 1 });
    expect(await claimMorningUnbooked(clientId, "2026-09-30", "+14155559999")).toBeNull();
    expect(await lastMorningUnbookedSentAt(clientId)).toBeInstanceOf(Date);
    expect(await claimMorningUnbooked(otherId, "2026-09-30", "+14155559999")).toBeTruthy();
  });
});
