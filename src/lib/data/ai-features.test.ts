import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The switchboard's recent counts against a real in-process Postgres (PGlite)
 * with the full schema: windows, failed-send exclusion, "off features aren't
 * queried", and tenant scoping.
 */

vi.mock("@/db", async () => (await import("../../../test/helpers/pglite-db")).pgliteDb());

const { db } = await import("@/db");
const s = await import("@/db/schema");
const { getAiFeatureStats } = await import("./ai-features");

const NOW = new Date();
const H = 3_600_000;
const ago = (h: number) => new Date(NOW.getTime() - h * H);
const allOn = { aiTextReplies: true, missedCallTexts: true, smartRebooking: true, dailyBriefing: true };

let clientId: string;
let otherId: string;

beforeAll(async () => {
  const [org] = await db.insert(s.organizations).values({ name: "Biz", kind: "business" }).returning();
  const [c] = await db.insert(s.clients).values({ orgId: org.id, name: "Bright" }).returning();
  const [o] = await db.insert(s.clients).values({ orgId: org.id, name: "Other" }).returning();
  clientId = c.id;
  otherId = o.id;
  const out = (kind: string, status: "sent" | "delivered" | "failed", h: number, cid = clientId) => ({
    clientId: cid, direction: "outbound" as const, customerPhone: "14155550001", body: "x", status, kind, createdAt: ago(h),
  });
  await db.insert(s.smsMessages).values([
    out("ai_reply", "delivered", 2),
    out("ai_reply", "sent", 30),
    out("ai_reply", "failed", 3), // failed — not handled
    out("ai_reply", "sent", 24 * 8), // older than a week
    out("appointment_reminder", "sent", 2), // not the AI
    out("ai_reply", "sent", 2, otherId), // other business
  ]);
  await db.insert(s.smsThreads).values([
    { clientId, customerPhone: "1", aiPaused: true, aiPausedReason: "handoff:urgent", aiPausedAt: ago(5) },
    { clientId, customerPhone: "2", aiPaused: true, aiPausedReason: "owner", aiPausedAt: ago(5) },
    { clientId, customerPhone: "3", aiPaused: true, aiPausedReason: "handoff:unsure", aiPausedAt: ago(24 * 9) },
  ]);
  const [call] = await db.insert(s.calls).values({ clientId, startAt: ago(4) }).returning();
  const [call2] = await db.insert(s.calls).values({ clientId, startAt: ago(4) }).returning();
  await db.insert(s.callCallbacks).values([
    { clientId, callId: call.id, customerPhone: "1", reason: "dropped", status: "sent", sentAt: ago(3) },
    { clientId, callId: call2.id, customerPhone: "2", reason: "dropped", status: "pending" },
  ]);
  const [appt] = await db.insert(s.appointments).values({ clientId, startAt: ago(-24) }).returning();
  const [appt2] = await db.insert(s.appointments).values({ clientId, startAt: ago(-48) }).returning();
  await db.insert(s.rebookOffers).values([
    { clientId, appointmentId: appt.id, customerPhone: "1", status: "rescheduled", sentAt: ago(10) },
    { clientId, appointmentId: appt2.id, customerPhone: "2", status: "skipped", skipReason: "no_consent" },
  ]);
  await db.insert(s.notifications).values([
    { clientId, type: "digest_daily", channel: "email", recipient: "a@b.c", status: "sent", sentAt: ago(30), payload: { kind: "daily_briefing" } },
    { clientId, type: "digest_daily", channel: "email", recipient: "a@b.c", status: "sent", sentAt: ago(6), payload: { kind: "daily_briefing" } },
    { clientId, type: "digest_daily", channel: "email", recipient: "a@b.c", status: "failed", sentAt: ago(1), payload: { kind: "daily_briefing" } },
  ]);
});

describe("getAiFeatureStats", () => {
  it("counts this week's delivered AI texts and handoffs, and the rest", async () => {
    const st = await getAiFeatureStats(clientId, allOn, NOW);
    expect(st.aiReplies7d).toBe(2);
    expect(st.aiHandoffs7d).toBe(1);
    expect(st.callbacks7d).toEqual({ sent: 1, pending: 1, failed: 0 });
    expect(st.rebook30d).toEqual({ sent: 1, rebooked: 1 });
    expect(st.lastBriefingSentAt?.getTime()).toBe(ago(6).getTime());
  });

  it("doesn't query features that are off", async () => {
    const st = await getAiFeatureStats(
      clientId,
      { aiTextReplies: false, missedCallTexts: false, smartRebooking: false, dailyBriefing: false },
      NOW,
    );
    expect(st).toEqual({ aiReplies7d: null, aiHandoffs7d: null, callbacks7d: null, rebook30d: null, lastBriefingSentAt: null });
  });

  it("is scoped to the business", async () => {
    const st = await getAiFeatureStats(otherId, allOn, NOW);
    expect(st.aiReplies7d).toBe(1);
    expect(st.aiHandoffs7d).toBe(0);
    expect(st.rebook30d).toEqual({ sent: 0, rebooked: 0 });
    expect(st.lastBriefingSentAt).toBeNull();
  });
});
