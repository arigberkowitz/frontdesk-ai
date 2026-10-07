import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Trial reminder emails, against a real (in-process) Postgres. The email
 * vendor is mocked: these tests never send anything.
 *
 * The 3-days-left email is opt-in. Nobody who didn't ask for it gets it, and
 * the existing 7-day / 1-day check-ins behave exactly as before for them.
 */

process.env.RESEND_API_KEY = "re_test_never_used";

const sent: { to: string; subject: string; html: string }[] = [];
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
