import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Trial reminder emails, against a real (in-process) Postgres. The email
 * vendor is mocked: these tests never send anything.
 *
 * The 3-days-left email is opt-in. Nobody who didn't ask for it gets it, and
 * the existing 7-day / 1-day check-ins behave exactly as before for them.
 */

process.env.RESEND_API_KEY = "re_test_never_used";

const sent: { to: string; subject: string; html: string; text?: string }[] = [];
vi.mock("@/lib/notifier", () => ({
  notifier: {
    sendEmail: vi.fn(async (m: { to: string; subject: string; html: string }) => {
      sent.push(m);
      return { ok: true };
    }),
  },
}));
vi.mock("@/db", async () => (await import("../../test/helpers/pglite-db")).pgliteDb());
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { db } = await import("@/db");
const schema = await import("@/db/schema");
const { eq } = await import("drizzle-orm");
const { dueTrialEmail, runTrialReminders } = await import("./lifecycle");

const DAY = 86_400_000;
const NOW = new Date("2026-10-07T15:00:00Z");

async function trialClient(daysLeft: number, flags: Record<string, unknown> = {}) {
  const [org] = await db.insert(schema.organizations).values({ name: "House", kind: "agency" }).returning();
  const [c] = await db
    .insert(schema.clients)
    .values({
      orgId: org!.id,
      name: "Nick's Barbershop",
      timezone: "America/New_York",
      status: "trial",
      ownerEmail: "nick@biz.test",
      trialEndsAt: new Date(NOW.getTime() + daysLeft * DAY - 60_000),
      setupFlags: flags,
    })
    .returning();
  return c!;
}

beforeEach(async () => {
  sent.length = 0;
  await db.delete(schema.leads);
  await db.delete(schema.appointments);
  await db.delete(schema.calls);
  await db.delete(schema.subscriptions);
  await db.delete(schema.clients);
  await db.delete(schema.organizations);
});

describe("dueTrialEmail", () => {
  it("leaves the 7-day and 1-day windows as they were without opt-in", () => {
    expect(dueTrialEmail(7, {}, false)).toBe("d7");
    expect(dueTrialEmail(3, {}, false)).toBe("d7"); // late cron still catches d7
    expect(dueTrialEmail(3, { d7: "x" }, false)).toBeNull();
    expect(dueTrialEmail(1, { d7: "x" }, false)).toBe("d1");
    expect(dueTrialEmail(8, {}, false)).toBeNull();
  });

  it("adds the 3-day email only for owners who opted in, once", () => {
    expect(dueTrialEmail(3, { d7: "x" }, true)).toBe("d3");
    expect(dueTrialEmail(2, { d7: "x" }, true)).toBe("d3");
    expect(dueTrialEmail(3, { d7: "x", d3: "x" }, true)).toBeNull();
    expect(dueTrialEmail(4, { d7: "x" }, true)).toBeNull();
  });

  it("never sends a stale 'one week left' after the 3-day one", () => {
    expect(dueTrialEmail(2, { d3: "x" }, true)).toBeNull();
  });

  it("the last-day email still wins", () => {
    expect(dueTrialEmail(1, { d7: "x" }, true)).toBe("d1");
  });
});

describe("runTrialReminders", () => {
  it("off by default: 3 days out, no opt-in → no 3-day email", async () => {
    await trialClient(3, { trialEmails: { d7: "2026-10-03T00:00:00Z" } });
    const r = await runTrialReminders(NOW);
    expect(r.sent).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("opted in: sends the 3-day email once, with the upgrade link, and stamps it", async () => {
    const c = await trialClient(3, { trialReminderOptIn: true, trialEmails: { d7: "2026-10-03T00:00:00Z" } });
    expect((await runTrialReminders(NOW)).sent).toBe(1);
    expect(sent[0]!.subject).toBe("Nick's Barbershop: 3 days left on your free trial");
    expect(sent[0]!.html).toContain("/portal/guidelines#plans");
    expect(sent[0]!.html).toContain("You asked us for this reminder");
    const row = await db.query.clients.findFirst({ where: eq(schema.clients.id, c.id) });
    expect(row?.setupFlags?.trialEmails?.d3).toBeTruthy();

    // Next day's cron: nothing more until the last-day email.
    expect((await runTrialReminders(new Date(NOW.getTime() + DAY))).sent).toBe(0);
  });

  it("skips paying and comped businesses even if they opted in", async () => {
    const paid = await trialClient(3, { trialReminderOptIn: true, trialEmails: { d7: "x" } });
    await db.insert(schema.subscriptions).values({ clientId: paid.id, status: "active" });
    await trialClient(3, { trialReminderOptIn: true, comped: true, trialEmails: { d7: "x" } });
    expect((await runTrialReminders(NOW)).sent).toBe(0);
  });
});

describe("day-7 trial summary", () => {
  it("sends the real counts once, with the plan link and no prices", async () => {
    const c = await trialClient(7);
    await db.update(schema.clients).set({ createdAt: new Date(NOW.getTime() - 7 * DAY) }).where(eq(schema.clients.id, c.id));
    const start = new Date(NOW.getTime() - 2 * DAY);
    const [k] = await db
      .insert(schema.calls)
      .values([
        { clientId: c.id, retellCallId: "d7a", toNumber: "+14155550123", startAt: start },
        { clientId: c.id, retellCallId: "d7b", toNumber: "+14155550123", startAt: start, isAfterHours: true },
        { clientId: c.id, retellCallId: "d7c", toNumber: "+14155550123", startAt: start, outcome: "spam" },
      ])
      .returning();
    await db.insert(schema.appointments).values({ clientId: c.id, callId: k!.id, startAt: new Date(NOW.getTime() + DAY) });
    await db.insert(schema.leads).values({ clientId: c.id, callId: k!.id, name: "Sam" });

    expect((await runTrialReminders(NOW)).sent).toBe(1);
    const m = sent[0]!;
    expect(m.subject).toBe("Nick's Barbershop: your first week — 2 calls answered, 1 booked");
    expect(m.text).toContain("Calls answered: 2");
    expect(m.text).toContain("Appointments booked: 1");
    expect(m.text).toContain("Messages taken: 1");
    expect(m.html).toContain("/portal/guidelines?plans=open#plans");
    expect(m.html).toContain("one flat monthly price");
    expect(m.html).not.toMatch(/\$\d/);

    const row = await db.query.clients.findFirst({ where: eq(schema.clients.id, c.id) });
    expect(row?.setupFlags?.trialEmails?.d7).toBeTruthy();
    // Daily cron the next few days: never again.
    for (let d = 1; d <= 4; d++) expect((await runTrialReminders(new Date(NOW.getTime() + d * DAY))).sent).toBe(0);
  });

  it("zero calls: the setup version, not a table of zeros", async () => {
    await trialClient(7);
    expect((await runTrialReminders(NOW)).sent).toBe(1);
    expect(sent[0]!.subject).toBe("Nick's Barbershop: one step left before your AI takes calls");
    expect(sent[0]!.text).toContain("doesn't have its own phone number yet");
    expect(sent[0]!.text).not.toContain("Calls answered");
  });

  it("not before day 7, and never for a business that already got it", async () => {
    await trialClient(8);
    await trialClient(6, { trialEmails: { d7: "2026-10-06T00:00:00Z" } });
    expect((await runTrialReminders(NOW)).sent).toBe(0);
  });
});
