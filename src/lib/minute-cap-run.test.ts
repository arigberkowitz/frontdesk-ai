import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Minute-cap alerts against a real (in-process) Postgres with the full schema:
 * what's counted, the cap + 10% boundary, once per billing period for the
 * owner and for the operator, and a fresh start each period. Email is faked.
 */

vi.mock("@/db", async () => (await import("../../test/helpers/pglite-db")).pgliteDb());
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/env", () => ({ env: { APP_URL: "https://app.test/" }, integrations: { resend: () => true } }));
vi.mock("@/lib/lifecycle", () => ({
  questionsLine: () => "Questions? Reply to this email.",
  questionsLineHtml: () => "Questions? Reply to this email.",
}));
let sendOk = true;
const sendEmail = vi.fn(async (_m: { to: string; subject: string; text?: string }) => ({ ok: sendOk }));
vi.mock("@/lib/notifier", () => ({ notifier: { sendEmail: (m: { to: string; subject: string }) => sendEmail(m) } }));

const { db } = await import("@/db");
const schema = await import("@/db/schema");
const { eq } = await import("drizzle-orm");
const { runMinuteCapAlerts, markAdminFlagged, countedMinutesSince } = await import("./minute-cap-run");

const NOW = new Date("2026-05-20T13:30:00.000Z");
const PERIOD_END = new Date("2026-06-03T00:00:00.000Z"); // period started 2026-05-03

async function business(opts: {
  plan: string;
  status?: "active" | "past_due" | "trialing" | "canceled";
  minutes: number;
  flags?: Record<string, unknown>;
  periodEnd?: Date;
}) {
  const [org] = await db.insert(schema.organizations).values({ name: "House", kind: "agency" }).returning();
  const [c] = await db
    .insert(schema.clients)
    .values({ orgId: org!.id, name: "Mission Plumbing", status: "live", ownerEmail: "owner@biz.test", setupFlags: opts.flags ?? {} })
    .returning();
  await db.insert(schema.subscriptions).values({
    clientId: c!.id,
    plan: opts.plan,
    status: opts.status ?? "active",
    currentPeriodEnd: opts.periodEnd ?? PERIOD_END,
  });
  if (opts.minutes > 0) {
    await db.insert(schema.calls).values({
      clientId: c!.id,
      retellCallId: `call_${c!.id}`,
      startAt: new Date("2026-05-10T17:00:00.000Z"),
      durationSec: opts.minutes * 60,
      outcome: "booked",
      fromNumber: "+14155550101",
    });
  }
  return c!;
}

async function flagsOf(id: string) {
  const c = await db.query.clients.findFirst({ where: eq(schema.clients.id, id) });
  return c?.setupFlags ?? {};
}

beforeEach(async () => {
  sendOk = true;
  sendEmail.mockClear();
  await db.delete(schema.calls);
  await db.delete(schema.subscriptions);
  await db.delete(schema.clients);
});

describe("runMinuteCapAlerts", () => {
  it("Rescue at exactly 220 minutes: nothing; at 221: one owner email and one operator flag", async () => {
    await business({ plan: "backup", minutes: 220 });
    expect(await runMinuteCapAlerts(NOW)).toEqual({ ownersEmailed: 0, adminFlags: [] });
    expect(sendEmail).not.toHaveBeenCalled();

    const over = await business({ plan: "backup", minutes: 221 });
    const r = await runMinuteCapAlerts(NOW);
    expect(r.ownersEmailed).toBe(1);
    expect(r.adminFlags.map((f) => f.clientId)).toEqual([over.id]);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0]![0].to).toBe("owner@biz.test");
    expect(sendEmail.mock.calls[0]![0].subject).toBe("Mission Plumbing: 221 minutes of calls since May 3");
  });

  it("Starter 550 / Pro 2,750 are the lines", async () => {
    await business({ plan: "starter", minutes: 550 });
    await business({ plan: "pro", minutes: 2_750 });
    expect((await runMinuteCapAlerts(NOW)).adminFlags).toHaveLength(0);
    await business({ plan: "starter", minutes: 551 });
    await business({ plan: "pro", minutes: 2_751 });
    expect((await runMinuteCapAlerts(NOW)).adminFlags).toHaveLength(2);
  });

  it("emails the owner and flags the operator once per billing period", async () => {
    const c = await business({ plan: "backup", minutes: 300 });
    const first = await runMinuteCapAlerts(NOW);
    expect(first.ownersEmailed).toBe(1);
    await markAdminFlagged(first.adminFlags, NOW);
    expect((await flagsOf(c.id)).minuteCap).toMatchObject({
      period: "2026-05-03T00:00:00.000Z",
      ownerWarnedAt: NOW.toISOString(),
      adminFlaggedAt: NOW.toISOString(),
    });

    const next = await runMinuteCapAlerts(new Date("2026-05-21T13:30:00.000Z"));
    expect(next).toEqual({ ownersEmailed: 0, adminFlags: [] });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("the operator keeps being flagged until the health email actually goes out", async () => {
    await business({ plan: "backup", minutes: 300 });
    await runMinuteCapAlerts(NOW); // health email failed: markAdminFlagged never ran
    const again = await runMinuteCapAlerts(new Date("2026-05-21T13:30:00.000Z"));
    expect(again.adminFlags).toHaveLength(1);
    expect(again.ownersEmailed).toBe(0); // the owner already heard
  });

  it("a failed owner send is retried tomorrow", async () => {
    sendOk = false;
    const c = await business({ plan: "backup", minutes: 300 });
    expect((await runMinuteCapAlerts(NOW)).ownersEmailed).toBe(0);
    expect((await flagsOf(c.id)).minuteCap).toBeUndefined();
    sendOk = true;
    expect((await runMinuteCapAlerts(new Date("2026-05-21T13:30:00.000Z"))).ownersEmailed).toBe(1);
  });

  it("a new billing period starts clean", async () => {
    await business({
      plan: "backup",
      minutes: 300,
      flags: { minuteCap: { period: "2026-04-03T00:00:00.000Z", ownerWarnedAt: "x", adminFlaggedAt: "x" } },
    });
    const r = await runMinuteCapAlerts(NOW);
    expect(r.ownersEmailed).toBe(1);
    expect(r.adminFlags).toHaveLength(1);
  });

  it("last period's calls don't count", async () => {
    const c = await business({ plan: "backup", minutes: 0 });
    await db.insert(schema.calls).values({
      clientId: c.id,
      retellCallId: "call_april",
      startAt: new Date("2026-04-25T17:00:00.000Z"),
      durationSec: 900 * 60,
    });
    expect((await runMinuteCapAlerts(NOW)).adminFlags).toHaveLength(0);
  });

  it("robocalls and blocked callers don't count toward the cap", async () => {
    const c = await business({ plan: "backup", minutes: 150, flags: { blockedNumbers: ["+14155550142"] } });
    await db.insert(schema.calls).values([
      { clientId: c.id, retellCallId: "spam_1", startAt: new Date("2026-05-11T17:00:00.000Z"), durationSec: 100 * 60, outcome: "spam", fromNumber: "+18005550199" },
      { clientId: c.id, retellCallId: "blk_1", startAt: new Date("2026-05-11T18:00:00.000Z"), durationSec: 100 * 60, outcome: "lead", fromNumber: "+14155550142" },
    ]);
    expect(await countedMinutesSince(c.id, new Date("2026-05-03T00:00:00.000Z"), ["+14155550142"])).toBe(150);
    expect((await runMinuteCapAlerts(NOW)).adminFlags).toHaveLength(0);
  });

  it("skips comped businesses, Stripe trials and cancelled subscriptions", async () => {
    await business({ plan: "backup", minutes: 900, flags: { comped: true } });
    await business({ plan: "backup", minutes: 900, status: "trialing" });
    await business({ plan: "backup", minutes: 900, status: "canceled" });
    expect(await runMinuteCapAlerts(NOW)).toEqual({ ownersEmailed: 0, adminFlags: [] });
  });

  it("keeps the rest of setup_flags intact", async () => {
    const c = await business({ plan: "backup", minutes: 300, flags: { blockedNumbers: ["+14155550142"], featuresReviewed: true } });
    await runMinuteCapAlerts(NOW);
    expect(await flagsOf(c.id)).toMatchObject({ blockedNumbers: ["+14155550142"], featuresReviewed: true });
  });
});
