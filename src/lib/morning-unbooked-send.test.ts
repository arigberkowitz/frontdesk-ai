import { beforeEach, describe, expect, it, vi } from "vitest";

/** The cron runner: who gets the morning text, when, and that a day never double-sends. */

const clientsRows: Record<string, unknown>[] = [];
vi.mock("@/db", () => ({ db: { query: { clients: { findMany: vi.fn(async () => clientsRows) } } } }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const envMock = { APP_URL: "https://app.test", SMS_ENABLED: true };
vi.mock("@/lib/env", () => ({ env: envMock }));
const sendSms = vi.fn(async (_m: { to: string; body: string }) => ({ ok: true }) as { ok: boolean; skipped?: boolean; error?: string });
const sendEmail = vi.fn();
vi.mock("@/lib/notifier", () => ({ notifier: { sendSms, sendEmail } }));
vi.mock("@/lib/data/alert-contacts", () => ({
  getAlertRecipients: vi.fn(async (c: { escalationNumber: string | null }) => ({
    emails: [],
    phones: c.escalationNumber ? [c.escalationNumber] : [],
  })),
}));
const optedOut = new Set<string>();
vi.mock("@/lib/data/sms-optouts", () => ({ isOptedOut: vi.fn(async (p: string) => optedOut.has(p)) }));
const prefs = { current: null as null | { quietStartHour: number; quietEndHour: number } };
vi.mock("@/lib/data/texting-prefs", () => ({ getTextingPrefs: vi.fn(async () => prefs.current) }));
const pro = new Set<string>();
vi.mock("@/lib/plan-access", () => ({
  planAccessFor: vi.fn(async (c: { id: string }) => ({ has: (f: string) => f === "outbound_ai_calls" && pro.has(c.id) })),
}));
const callersFor = new Map<string, unknown[] | null>();
const claimed = new Set<string>();
const finish = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock("@/lib/data/morning-unbooked", () => ({
  getUnbookedAfterHoursCallers: vi.fn(async (c: { id: string }) => callersFor.get(c.id) ?? []),
  claimMorningUnbooked: vi.fn(async (id: string, day: string) => {
    const k = `${id}:${day}`;
    if (claimed.has(k)) return null;
    claimed.add(k);
    return `claim-${k}`;
  }),
  finishMorningUnbooked: (...a: unknown[]) => finish(...a),
}));

const { sendMorningUnbookedTexts } = await import("./morning-unbooked-send");

const NOW = new Date("2026-09-30T12:30:00Z"); // 8:30 EDT, 5:30 PDT
const caller = { callId: "c1", leadId: "L1", name: "Maria Lopez", phone: "+14155550100", wanted: "Water heater quote", hungUp: false, startAt: null };
const row = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `Biz ${id}`,
  status: "live",
  timezone: "America/New_York",
  escalationNumber: `+1415555${String(1000 + id.charCodeAt(0) * 7 + id.length).slice(-4)}`,
  smsAlertsEnabled: true,
  setupFlags: { morningUnbookedText: true },
  ...over,
});

beforeEach(() => {
  clientsRows.length = 0;
  claimed.clear();
  callersFor.clear();
  optedOut.clear();
  pro.clear();
  prefs.current = null;
  envMock.SMS_ENABLED = true;
  sendSms.mockClear();
  finish.mockClear();
});

describe("sendMorningUnbookedTexts", () => {
  it("texts opted-in businesses whose morning it is, once per day, never email", async () => {
    clientsRows.push(row("a"), row("off", { setupFlags: {} }), row("west", { timezone: "America/Los_Angeles" }));
    callersFor.set("a", [caller]);
    callersFor.set("west", [caller]);
    const r = await sendMorningUnbookedTexts(NOW);
    expect(r).toMatchObject({ clients: 3, sent: 1, optedOut: 1, notDue: 1, failed: 0 });
    expect(sendSms).toHaveBeenCalledTimes(1);
    expect(sendSms.mock.calls[0][0].body).toContain("Maria Lopez");
    expect(sendSms.mock.calls[0][0].body).toContain("https://app.test/portal/leads#lead-L1");
    expect(sendEmail).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledWith("claim-a:2026-09-30", expect.objectContaining({ status: "sent", callers: 1 }));

    const again = await sendMorningUnbookedTexts(new Date("2026-09-30T13:15:00Z"));
    expect(again).toMatchObject({ sent: 0, alreadySent: 1 });
    expect(sendSms).toHaveBeenCalledTimes(1);
  });

  it("sends nothing (and claims nothing) when nobody needs chasing or the lookup failed", async () => {
    clientsRows.push(row("a"), row("b"));
    callersFor.set("a", []);
    callersFor.set("b", null);
    const r = await sendMorningUnbookedTexts(NOW);
    expect(r).toMatchObject({ sent: 0, nothingToSend: 2 });
    expect(sendSms).not.toHaveBeenCalled();
    expect(claimed.size).toBe(0);
  });

  it("holds everything while texting is pending carrier approval", async () => {
    envMock.SMS_ENABLED = false;
    clientsRows.push(row("a"));
    callersFor.set("a", [caller]);
    const r = await sendMorningUnbookedTexts(NOW);
    expect(r).toMatchObject({ smsPending: 1, sent: 0 });
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("respects text alerts off, STOP, and the owner's quiet hours", async () => {
    clientsRows.push(row("a", { smsAlertsEnabled: false }), row("b"));
    optedOut.add(row("b").escalationNumber);
    callersFor.set("a", [caller]);
    callersFor.set("b", [caller]);
    let r = await sendMorningUnbookedTexts(NOW);
    expect(r).toMatchObject({ noRecipient: 2, sent: 0 });

    optedOut.clear();
    clientsRows.length = 0;
    clientsRows.push(row("c"));
    callersFor.set("c", [caller]);
    prefs.current = { quietStartHour: 21, quietEndHour: 9 }; // 8:30 local is still quiet
    r = await sendMorningUnbookedTexts(NOW);
    expect(r).toMatchObject({ notDue: 1, sent: 0 });
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("adds the AI-call hint only on plans with AI call-backs", async () => {
    clientsRows.push(row("a"), row("b"));
    callersFor.set("a", [caller]);
    callersFor.set("b", [caller]);
    pro.add("a");
    await sendMorningUnbookedTexts(NOW);
    const bodies = Object.fromEntries(sendSms.mock.calls.map((c) => [c[0].to, c[0].body]));
    expect(bodies[row("a").escalationNumber]).toContain("AI calls them");
    expect(bodies[row("b").escalationNumber]).not.toContain("AI calls them");
  });

  it("records an unconfigured texting provider as skipped (retryable), not sent", async () => {
    clientsRows.push(row("a"));
    callersFor.set("a", [caller]);
    sendSms.mockResolvedValueOnce({ ok: false, skipped: true });
    const r = await sendMorningUnbookedTexts(NOW);
    expect(r).toMatchObject({ sent: 0, skipped: 1 });
    expect(finish).toHaveBeenCalledWith("claim-a:2026-09-30", expect.objectContaining({ status: "skipped" }));
  });
});
