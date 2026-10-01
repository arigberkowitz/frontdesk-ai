import { beforeEach, describe, expect, it, vi } from "vitest";

/** The cron runner: who gets a briefing, when, and that a claimed day never double-sends. */

const clientsRows: Record<string, unknown>[] = [];
vi.mock("@/db", () => ({ db: { query: { clients: { findMany: vi.fn(async () => clientsRows) } } } }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/env", () => ({ env: { APP_URL: "https://app.test" } }));
const sendEmail = vi.fn(async (_m: { to: string; subject: string }) => ({ ok: true }) as { ok: boolean; skipped?: boolean; error?: string });
const sendSms = vi.fn();
vi.mock("@/lib/notifier", () => ({ notifier: { sendEmail, sendSms } }));
vi.mock("@/lib/agents/briefing", () => ({ writeBriefing: vi.fn(async () => null) }));
const claimed = new Set<string>();
const finish = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock("@/lib/data/daily-briefing", () => ({
  claimDailyBriefing: vi.fn(async (id: string, day: string) => {
    const k = `${id}:${day}`;
    if (claimed.has(k)) return null;
    claimed.add(k);
    return `claim-${k}`;
  }),
  finishDailyBriefing: (...a: unknown[]) => finish(...a),
  getBriefingFacts: vi.fn(async (c: { name: string; timezone: string }) => ({
    businessName: c.name,
    timeZone: c.timezone,
    dayKey: "2026-09-30",
    counts: { calls: 1, booked: 1, messages: 0, afterHours: 0, spam: 0, bookingsMade: 1, cancellations: 0 },
    cancellations: [],
    callbacks: [],
    today: [],
  })),
}));

const { sendDailyBriefings, dailyBriefingEnabled } = await import("./briefing-send");

const NOW = new Date("2026-09-30T11:30:00Z"); // 7:30 EDT, 4:30 PDT
const row = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `Biz ${id}`,
  timezone: "America/New_York",
  ownerEmail: `${id}@biz.test`,
  escalationNumber: "+14155559999",
  setupFlags: { dailyBriefing: true },
  ...over,
});

beforeEach(() => {
  clientsRows.length = 0;
  claimed.clear();
  sendEmail.mockClear();
  sendSms.mockClear();
  finish.mockClear();
});

describe("sendDailyBriefings", () => {
  it("emails opted-in businesses whose morning it is, once per day, and never texts", async () => {
    clientsRows.push(
      row("a"),
      row("off", { setupFlags: {} }),
      row("west", { timezone: "America/Los_Angeles" }),
      row("noemail", { ownerEmail: null }),
    );
    const r = await sendDailyBriefings(NOW);
    expect(r).toMatchObject({ clients: 4, sent: 1, optedOut: 1, notDue: 1, skipped: 1, failed: 0 });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0].to).toBe("a@biz.test");
    expect(sendSms).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledWith("claim-a:2026-09-30", expect.objectContaining({ status: "sent" }));

    // A second slot the same morning sends nothing.
    const again = await sendDailyBriefings(new Date("2026-09-30T12:10:00Z"));
    expect(again).toMatchObject({ sent: 0, alreadySent: 1 });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("records provider-not-configured as skipped (retryable), not sent", async () => {
    clientsRows.push(row("a"));
    sendEmail.mockResolvedValueOnce({ ok: false, skipped: true });
    const r = await sendDailyBriefings(NOW);
    expect(r).toMatchObject({ sent: 0, skipped: 1 });
    expect(finish).toHaveBeenCalledWith("claim-a:2026-09-30", expect.objectContaining({ status: "skipped" }));
  });

  it("is opt-in", () => {
    expect(dailyBriefingEnabled({ setupFlags: {} })).toBe(false);
    expect(dailyBriefingEnabled({ setupFlags: { dailyBriefing: true } })).toBe(true);
  });
});
