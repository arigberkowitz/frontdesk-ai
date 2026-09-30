import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The weekly summary run (sendWeeklyReports), dependencies mocked: opt-out,
 * once-per-week dedupe across repeated runs, quiet weeks, and retry after a
 * failed send. Never sends anything real.
 */

type C = { id: string; name: string; ownerEmail: string | null; weeklySummaryEnabled: boolean };
let clientsList: C[] = [];
const inserted: Record<string, unknown>[] = [];
vi.mock("@/db", () => ({
  db: {
    query: { clients: { findMany: vi.fn(async () => clientsList) } },
    insert: () => ({ values: async (v: Record<string, unknown>) => void inserted.push(v) }),
  },
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/env", () => ({ env: { APP_URL: "https://app.test" } }));

const core = { calls: 3, bookings: 1, afterHours: 1, leads: 1, estRevenueCents: 5000, upcomingRevenueCents: 0 };
let activity = { bookingsMade: 2, cancellations: 0, missedRecovered: 0, textsReceived: 1 };
vi.mock("@/lib/data/metrics", () => ({ getClientPeriodSummary: vi.fn(async () => core) }));
vi.mock("@/lib/data/calls", () => ({ getCallHealth: vi.fn(async () => null) }));

// In-memory stand-in for the weekly_summary_sends ledger (the real SQL is
// covered in data/weekly-summary.test.ts against PGlite).
const ledger = new Map<string, { id: string; status: string }>();
vi.mock("@/lib/data/weekly-summary", () => ({
  getWeeklyActivity: vi.fn(async () => activity),
  claimWeeklySummary: vi.fn(async (clientId: string, week: string) => {
    const key = `${clientId}:${week}`;
    const row = ledger.get(key);
    if (row && !["failed", "skipped"].includes(row.status)) return null;
    const id = row?.id ?? key;
    ledger.set(key, { id, status: "sending" });
    return id;
  }),
  finishWeeklySummary: vi.fn(async (id: string, o: { status: string }) => {
    ledger.set(id, { id, status: o.status });
  }),
}));

const sendEmail = vi.fn(async (_m: { to: string; subject: string; html?: string; text?: string }) => ({ ok: true }) as {
  ok: boolean;
  skipped?: boolean;
  error?: string;
});
const sendSms = vi.fn();
vi.mock("@/lib/notifier", () => ({ notifier: { sendEmail, sendSms } }));

const { sendWeeklyReports } = await import("./digest");
const MONDAY = new Date("2026-10-05T15:00:00Z");

beforeEach(() => {
  ledger.clear();
  inserted.length = 0;
  sendEmail.mockClear();
  sendSms.mockClear();
  activity = { bookingsMade: 2, cancellations: 0, missedRecovered: 0, textsReceived: 1 };
  clientsList = [
    { id: "c1", name: "Alpha Dental", ownerEmail: "a@a.test", weeklySummaryEnabled: true },
    { id: "c2", name: "Beta Plumbing", ownerEmail: "b@b.test", weeklySummaryEnabled: false },
    { id: "c3", name: "No Email Co", ownerEmail: null, weeklySummaryEnabled: true },
  ];
});

describe("sendWeeklyReports", () => {
  it("emails opted-in owners only, by email only", async () => {
    const r = await sendWeeklyReports(MONDAY);
    expect(r).toMatchObject({ clients: 3, sent: 1, optedOut: 1, skipped: 1, failed: 0, week: "2026-W41" });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0].to).toBe("a@a.test");
    expect(sendEmail.mock.calls[0][0].text).toContain("Texts from customers: 1");
    expect(sendSms).not.toHaveBeenCalled();
    expect(inserted[0]).toMatchObject({ type: "digest_weekly", channel: "email", status: "sent" });
  });

  it("never sends twice in the same week, even if the cron runs again", async () => {
    await sendWeeklyReports(MONDAY);
    const again = await sendWeeklyReports(new Date("2026-10-07T09:00:00Z")); // Wednesday, same ISO week
    expect(again).toMatchObject({ sent: 0, alreadySent: 1 });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("sends again the next week", async () => {
    await sendWeeklyReports(MONDAY);
    await sendWeeklyReports(new Date("2026-10-12T15:00:00Z"));
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  it("retries a week whose send failed", async () => {
    sendEmail.mockResolvedValueOnce({ ok: false, error: "provider down" });
    const first = await sendWeeklyReports(MONDAY);
    expect(first).toMatchObject({ sent: 0, failed: 1 });
    const retry = await sendWeeklyReports(MONDAY);
    expect(retry).toMatchObject({ sent: 1, alreadySent: 0 });
  });

  it("skips a week where nothing happened", async () => {
    core.calls = 0;
    core.bookings = 0;
    core.leads = 0;
    activity = { bookingsMade: 0, cancellations: 0, missedRecovered: 0, textsReceived: 0 };
    const r = await sendWeeklyReports(MONDAY);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(r.skipped).toBe(2);
    core.calls = 3;
    core.bookings = 1;
    core.leads = 1;
  });
});
