import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The day an unpaid trial ends, its agent switches to taking messages
 * (runTrialHold); three days later the number goes (runTrialLapse). Real
 * (in-process) Postgres with the full schema; the voice vendor is faked.
 */

vi.mock("@/db", async () => (await import("../../test/helpers/pglite-db")).pgliteDb());
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/env", () => ({
  env: { APP_URL: "https://app.test/" },
  integrations: { retell: () => true, resend: () => true },
}));
vi.mock("@/lib/lifecycle", () => ({ questionsLine: () => "Questions?", questionsLineHtml: () => "Questions?" }));
vi.mock("@/lib/notifier", () => ({ notifier: { sendEmail: vi.fn(async () => ({ ok: true })) } }));
const deleteNumber = vi.fn(async (_p: string) => ({}));
vi.mock("@/lib/retell", () => ({ getRetellClient: () => ({ phoneNumber: { delete: (p: string) => deleteNumber(p) } }) }));
let syncFails = false;
const syncAgentPrompt = vi.fn(async (_o: string, _c: string) => {
  if (syncFails) throw new Error("retell 503");
  return true;
});
vi.mock("@/lib/agent-publish", () => ({ syncAgentPrompt: (o: string, c: string) => syncAgentPrompt(o, c) }));

const { db } = await import("@/db");
const schema = await import("@/db/schema");
const { eq } = await import("drizzle-orm");
const { runTrialHold, runTrialLapse } = await import("./trial-lapse");

const NOW = new Date("2026-10-17T12:45:00.000Z");
const DAY = 86_400_000;

async function trial(extra: Partial<typeof schema.clients.$inferInsert> = {}, subStatus?: "active" | "trialing" | "canceled" | "incomplete") {
  const [org] = await db.insert(schema.organizations).values({ name: "House", kind: "agency" }).returning();
  const [c] = await db
    .insert(schema.clients)
    .values({
      orgId: org!.id,
      name: "Nick's Barbershop",
      status: "trial",
      trialEndsAt: new Date(NOW.getTime() - DAY / 2),
      retellLlmId: "llm_1",
      retellPhoneNumber: "+14155550100",
      ownerEmail: "owner@biz.test",
      ...extra,
    })
    .returning();
  if (subStatus) await db.insert(schema.subscriptions).values({ clientId: c!.id, status: subStatus, plan: "starter" });
  return c!;
}
const get = (id: string) => db.query.clients.findFirst({ where: eq(schema.clients.id, id) });

beforeEach(async () => {
  syncFails = false;
  syncAgentPrompt.mockClear();
  deleteNumber.mockClear();
  await db.delete(schema.subscriptions);
  await db.delete(schema.clients);
});

describe("runTrialHold", () => {
  it("switches an ended, unpaid trial to messages only, once", async () => {
    const c = await trial();
    expect(await runTrialHold(NOW)).toEqual({ held: 1, failed: 0 });
    expect(syncAgentPrompt).toHaveBeenCalledWith(c.orgId, c.id);
    expect((await get(c.id))?.setupFlags?.trialHoldAt).toBe(NOW.toISOString());
    // Status is untouched: the number still answers; nothing is paused yet.
    expect((await get(c.id))?.status).toBe("trial");

    expect(await runTrialHold(new Date(NOW.getTime() + DAY))).toEqual({ held: 0, failed: 0 });
    expect(syncAgentPrompt).toHaveBeenCalledTimes(1);
  });

  it("leaves running trials, paying, Stripe-trial and comped businesses alone", async () => {
    await trial({ trialEndsAt: new Date(NOW.getTime() + DAY) });
    await trial({}, "active");
    await trial({}, "trialing");
    await trial({ setupFlags: { comped: true } });
    await trial({ status: "live" });
    await trial({ trialEndsAt: null });
    expect(await runTrialHold(NOW)).toEqual({ held: 0, failed: 0 });
    expect(syncAgentPrompt).not.toHaveBeenCalled();
  });

  it("a subscription that didn't go through is still on hold", async () => {
    await trial({}, "incomplete");
    await trial({}, "canceled");
    expect((await runTrialHold(NOW)).held).toBe(2);
  });

  it("a Retell failure is counted, leaves no mark, and is retried next run", async () => {
    syncFails = true;
    const c = await trial();
    expect(await runTrialHold(NOW)).toEqual({ held: 0, failed: 1 });
    expect((await get(c.id))?.setupFlags?.trialHoldAt).toBeUndefined();
    syncFails = false;
    expect((await runTrialHold(NOW)).held).toBe(1);
  });

  it("keeps the rest of setup_flags", async () => {
    const c = await trial({ setupFlags: { featuresReviewed: true } });
    await runTrialHold(NOW);
    expect((await get(c.id))?.setupFlags).toMatchObject({ featuresReviewed: true, trialHoldAt: NOW.toISOString() });
  });
});

describe("runTrialLapse", () => {
  it("three days later releases the number, pauses, and marks the pause as the lapse's", async () => {
    const c = await trial({ trialEndsAt: new Date(NOW.getTime() - 4 * DAY), setupFlags: { trialHoldAt: "x" } });
    expect((await runTrialLapse(NOW)).released).toBe(1);
    expect(deleteNumber).toHaveBeenCalledWith("+14155550100");
    const after = await get(c.id);
    expect(after?.status).toBe("paused");
    expect(after?.retellPhoneNumber).toBeNull();
    expect(after?.setupFlags).toMatchObject({ trialHoldAt: "x", trialLapsedAt: NOW.toISOString() });
  });

  it("not inside the three days", async () => {
    await trial({ trialEndsAt: new Date(NOW.getTime() - 2 * DAY) });
    expect((await runTrialLapse(NOW)).released).toBe(0);
  });
});

describe("runTrialLapse — a Stripe trial that never paid", () => {
  async function cardTrial(sub: Partial<typeof schema.subscriptions.$inferInsert>) {
    const c = await trial({ status: "live", trialEndsAt: null });
    await db.insert(schema.subscriptions).values({ clientId: c.id, plan: "starter", status: "canceled", ...sub });
    return c;
  }

  it("releases the number once the canceled, never-paid subscription is past the grace", async () => {
    const c = await cardTrial({ currentPeriodEnd: new Date(NOW.getTime() - 4 * DAY), firstPaidAt: null });
    expect((await runTrialLapse(NOW)).released).toBe(1);
    expect(deleteNumber).toHaveBeenCalledWith("+14155550100");
    const after = await get(c.id);
    expect(after?.retellPhoneNumber).toBeNull();
    expect(after?.status).toBe("paused");
    expect(after?.setupFlags?.trialLapsedAt).toBeTruthy(); // paying later turns it back on
  });

  it("keeps the number for a business that ever paid, or one still inside the grace", async () => {
    await cardTrial({ currentPeriodEnd: new Date(NOW.getTime() - 4 * DAY), firstPaidAt: new Date(NOW.getTime() - 40 * DAY) });
    await cardTrial({ currentPeriodEnd: new Date(NOW.getTime() - DAY), firstPaidAt: null });
    expect((await runTrialLapse(NOW)).released).toBe(0);
    expect(deleteNumber).not.toHaveBeenCalled();
  });
});
