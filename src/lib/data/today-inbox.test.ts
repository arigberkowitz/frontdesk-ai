import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The Today inbox queries against a real in-process Postgres (PGlite) with the
 * full schema: the grouped counts, the 7-day windows, the "only things that
 * still need a person" filters, and above all the org scoping.
 */

vi.mock("@/db", async () => (await import("../../../test/helpers/pglite-db")).pgliteDb());
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { db } = await import("@/db");
const s = await import("@/db/schema");
const { getTodayInbox, getTodayInboxCounts } = await import("./today-inbox");

const NOW = new Date();
const D = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * D);
const ahead = (days: number) => new Date(NOW.getTime() + days * D);

let orgId: string;
let otherOrgId: string;
const ids: Record<string, string> = {};

beforeAll(async () => {
  const [org] = await db.insert(s.organizations).values({ name: "Agency", kind: "agency" }).returning();
  const [other] = await db.insert(s.organizations).values({ name: "Other agency", kind: "agency" }).returning();
  orgId = org.id;
  otherOrgId = other.id;
  const mk = async (key: string, o: string, status: "live" | "trial" | "paused", extra: Partial<typeof s.clients.$inferInsert> = {}) => {
    const [c] = await db.insert(s.clients).values({ orgId: o, name: key, status, ...extra }).returning();
    ids[key] = c.id;
    return c.id;
  };
  const lfj = await mk("Lawyers for justice", orgId, "live");
  const peak = await mk("Peak Plumbing", orgId, "live");
  const glow = await mk("Glow Med Spa", orgId, "trial", { trialEndsAt: ahead(4) });
  await mk("Later Trial", orgId, "trial", { trialEndsAt: ahead(20) });
  const gone = await mk("Deleted Co", orgId, "live", { deletedAt: ago(1) });
  const foreign = await mk("Foreign", otherOrgId, "live");

  await db.insert(s.leads).values([
    { clientId: lfj, name: "A", status: "new" },
    { clientId: lfj, name: "B", status: "new" },
    { clientId: lfj, name: "C", status: "contacted" },
    { clientId: lfj, name: "D", status: "new", deletedAt: ago(1) },
    { clientId: gone, name: "E", status: "new" },
    { clientId: foreign, name: "F", status: "new" },
  ]);
  await db.insert(s.smsMessages).values([
    // Two unread messages in ONE thread = one unread thread.
    { clientId: lfj, direction: "inbound", customerPhone: "14155550001", body: "hi", status: "received" },
    { clientId: lfj, direction: "inbound", customerPhone: "14155550001", body: "hello?", status: "received" },
    { clientId: lfj, direction: "inbound", customerPhone: "14155550002", body: "read", status: "received", readAt: ago(0.1) },
    { clientId: peak, direction: "outbound", customerPhone: "14155550003", body: "x", status: "failed", createdAt: ago(1) },
    { clientId: peak, direction: "outbound", customerPhone: "14155550003", body: "old", status: "failed", createdAt: ago(10) },
    { clientId: foreign, direction: "inbound", customerPhone: "14155550004", body: "not yours", status: "received" },
  ]);
  await db.insert(s.reminders).values([
    { clientId: peak, channel: "sms", status: "failed", createdAt: ago(2) },
    { clientId: peak, channel: "call", status: "failed", createdAt: ago(3) },
    { clientId: peak, channel: "sms", status: "failed", createdAt: ago(9) },
    { clientId: peak, channel: "sms", status: "sent", createdAt: ago(1) },
  ]);
  await db.insert(s.agentRuns).values([
    { clientId: lfj, kind: "qa_review", status: "failed", startedAt: ago(1) },
    { clientId: lfj, kind: "nightly_improve", status: "failed", startedAt: ago(8) },
    { clientId: lfj, kind: "copilot_chat", status: "failed", startedAt: ago(1) },
    { clientId: peak, kind: "nightly_improve", status: "succeeded", startedAt: ago(1) },
  ]);
  await db.insert(s.agentSuggestions).values([
    { clientId: peak, type: "knowledge", rationale: "r", status: "proposed" },
    { clientId: peak, type: "guidance", rationale: "r", status: "applied" },
  ]);
  const [call1, call2, call3] = await db
    .insert(s.calls)
    .values([{ clientId: lfj }, { clientId: peak }, { clientId: peak }])
    .returning();
  await db.insert(s.callGrades).values([
    { callId: call1.id, clientId: lfj, score: 2, status: "open" },
    { callId: call2.id, clientId: peak, score: 3, status: "open" },
    { callId: call3.id, clientId: peak, score: 5, status: "reviewed" },
  ]);
  void glow;
});

describe("getTodayInboxCounts", () => {
  it("counts only what still needs a person, within the window", async () => {
    const c = await getTodayInboxCounts([ids["Lawyers for justice"], ids["Peak Plumbing"], ids["Glow Med Spa"], ids["Later Trial"]], NOW);
    const of = (rows: { clientId: string; count: number }[], key: string) =>
      rows.find((r) => r.clientId === ids[key])?.count ?? 0;

    expect(of(c.newLeads, "Lawyers for justice")).toBe(2); // not contacted, not deleted
    expect(of(c.unreadThreads, "Lawyers for justice")).toBe(1); // threads, not messages
    expect(of(c.proposedFixes, "Peak Plumbing")).toBe(1);
    expect(of(c.openGrades, "Lawyers for justice")).toBe(1);
    expect(of(c.openGrades, "Peak Plumbing")).toBe(1);
    expect(of(c.failedReminders, "Peak Plumbing")).toBe(2); // 9-day-old one is outside the window
    expect(of(c.failedTexts, "Peak Plumbing")).toBe(1);
    expect(of(c.failedRuns, "Lawyers for justice")).toBe(1); // old run + copilot throttle row excluded
    expect(c.trialsEnding.map((t) => t.clientId)).toEqual([ids["Glow Med Spa"]]); // 20 days out is not "soon"
  });

  it("returns nothing for no clients without querying", async () => {
    const c = await getTodayInboxCounts([], NOW);
    expect(Object.values(c).every((v) => Array.isArray(v) && v.length === 0)).toBe(true);
  });
});

describe("getTodayInbox", () => {
  it("is scoped to the operator's org and skips deleted clients", async () => {
    const { items } = await getTodayInbox(orgId, NOW);
    const names = new Set(items.map((i) => i.clientName));
    expect(names.has("Foreign")).toBe(false);
    expect(names.has("Deleted Co")).toBe(false);
    expect(items.map((i) => i.key)).toEqual([
      `unread_sms:${ids["Lawyers for justice"]}`,
      `new_leads:${ids["Lawyers for justice"]}`,
      `failed_sends:${ids["Peak Plumbing"]}`,
      `trial_ending:${ids["Glow Med Spa"]}`,
      `proposed_fixes:${ids["Peak Plumbing"]}`,
      "open_grades",
      `failed_runs:${ids["Lawyers for justice"]}`,
    ]);
  });

  it("the other org only sees its own items", async () => {
    const { items } = await getTodayInbox(otherOrgId, NOW);
    expect(items.map((i) => i.kind).sort()).toEqual(["new_leads", "unread_sms"]);
    expect(items.every((i) => i.clientName === "Foreign")).toBe(true);
  });
});
