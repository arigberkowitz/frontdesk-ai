import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Signup safety, end to end against a real (in-process) Postgres with the full
 * schema. Only the voice vendor is faked: every number "purchase" is counted,
 * so these tests say exactly how many phone numbers each path would buy.
 *
 *  - A self-serve signup builds the agent but buys no number until the owner
 *    has made one test call; then exactly one, however often it's asked for.
 *  - Repeated signups / repeated Activate presses without a test call buy nothing.
 *  - A real payment, a saved card (Stripe trial), an operator, a comp or an
 *    operator-approved trial unlocks exactly one number — even under
 *    concurrent clicks.
 *  - An ended or lapsed trial never gets one; a platform-wide daily cap
 *    stops a burst of trial signups buying more than TRIAL_NUMBERS_PER_DAY.
 */

process.env.RETELL_API_KEY = "key_test";
process.env.APP_URL = "https://app.frontdesk.test";

const purchases: string[] = [];
const provisionCalls: { clientId: string; skipNewNumber?: boolean }[] = [];

vi.mock("@/db", async () => (await import("../../test/helpers/pglite-db")).pgliteDb());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const afterTasks: (() => Promise<unknown>)[] = [];
vi.mock("next/server", () => ({ after: (fn: () => Promise<unknown>) => afterTasks.push(fn) }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/lifecycle", () => ({ sendWelcomeEmail: vi.fn(async () => {}) }));
vi.mock("@/lib/booking", () => ({
  getBookingProviderForClient: () => ({ isConfigured: () => false }),
}));
vi.mock("@/lib/retell", async (orig) => ({
  ...(await orig<typeof import("@/lib/retell")>()),
  provisionAgentForClient: async (input: {
    clientId: string;
    existingPhoneNumber?: string | null;
    skipNewNumber?: boolean;
  }) => {
    provisionCalls.push({ clientId: input.clientId, skipNewNumber: input.skipNewNumber });
    // A little latency so concurrent runs genuinely overlap.
    await new Promise((r) => setTimeout(r, 20));
    let phoneNumber = input.existingPhoneNumber ?? null;
    if (!phoneNumber && !input.skipNewNumber) {
      phoneNumber = `+1415555${String(1000 + purchases.length).slice(-4)}`;
      purchases.push(input.clientId);
    }
    return { llmId: `llm_${input.clientId}`, agentId: `agent_${input.clientId}`, phoneNumber, phoneError: null };
  },
}));

const { db } = await import("@/db");
const schema = await import("@/db/schema");
const { eq } = await import("drizzle-orm");
const { runProvision, provisionNumberAfterPayment, provisionNumberIfUnlocked } = await import("./provision");
const { TRIAL_NUMBERS_PER_DAY } = await import("./number-gate");
const { finishSignup } = await import("./signup");

type Role = "operator" | "client_admin";

async function seed(role: Role = "client_admin") {
  const [org] = await db.insert(schema.organizations).values({ name: "House", kind: "agency" }).returning();
  const [user] = await db
    .insert(schema.users)
    .values({ orgId: org!.id, clerkUserId: `clerk_${Math.random()}`, email: "owner@biz.test", role })
    .returning();
  return { org: org!, user: user! };
}

async function newClient(orgId: string, extra: Partial<typeof schema.clients.$inferInsert> = {}) {
  const [c] = await db
    .insert(schema.clients)
    .values({
      orgId,
      name: "Nick's Barbershop",
      timezone: "America/New_York",
      status: "trial",
      trialEndsAt: new Date(Date.now() + 14 * 86_400_000),
      ownerEmail: "owner@biz.test",
      ...extra,
    })
    .returning();
  return c!;
}

async function row(clientId: string) {
  return db.query.clients.findFirst({ where: eq(schema.clients.id, clientId) });
}

/** Everything on the checklist that doesn't need the number, done for real. */
async function finishGuidedSetup(clientId: string, opts: { testCall: boolean }) {
  await db.insert(schema.services).values({ clientId, name: "Haircut", durationMin: 30 });
  await db.insert(schema.knowledgeItems).values({ clientId, question: "Parking?", answer: "Out back." });
  await db
    .insert(schema.businessHours)
    .values({ clientId, dayOfWeek: 1, openTime: "09:00", closeTime: "17:00", isClosed: false });
  await db
    .update(schema.clients)
    .set({ greeting: "Thanks for calling Nick's!", setupFlags: { calendarSkipped: true } })
    .where(eq(schema.clients.id, clientId));
  if (opts.testCall) {
    await db.insert(schema.calls).values({ clientId, retellCallId: `web_${clientId}`, startAt: new Date() });
  }
}

beforeEach(async () => {
  purchases.length = 0;
  provisionCalls.length = 0;
  afterTasks.length = 0;
  await db.delete(schema.calls);
  await db.delete(schema.subscriptions);
  await db.delete(schema.agentVersions);
  await db.delete(schema.users);
  await db.delete(schema.clients);
  await db.delete(schema.organizations);
});

const actor = (u: { id: string; orgId: string; role: Role | "client_viewer" }) => ({ id: u.id, orgId: u.orgId, role: u.role });

async function testCall(clientId: string) {
  await db.insert(schema.calls).values({ clientId, retellCallId: `web_${clientId}_${Math.random()}`, startAt: new Date() });
}

describe("signup buys no number until the first test call", () => {
  it("builds the agent for browser test calls, but buys no number", async () => {
    const { org, user } = await seed();
    const c = await newClient(org.id, { status: "draft", trialEndsAt: null });
    await finishSignup(actor(user), c.id, { industry: "barber", seedFromPack: false, companySize: "solo" });

    const after = await row(c.id);
    expect(after?.status).toBe("trial");
    expect(after?.retellAgentId).toBe(`agent_${c.id}`);
    expect(after?.retellPhoneNumber).toBeNull();
    expect(provisionCalls).toEqual([{ clientId: c.id, skipNewNumber: true }]);
    expect(purchases).toHaveLength(0);
  });

  it("abuse: ten throwaway signups buy zero numbers", async () => {
    for (let i = 0; i < 10; i++) {
      const { org, user } = await seed();
      const c = await newClient(org.id, { status: "draft", trialEndsAt: null });
      await finishSignup(actor(user), c.id, { industry: null, seedFromPack: false, companySize: "solo" });
    }
    expect(provisionCalls).toHaveLength(10);
    expect(purchases).toHaveLength(0);
  });

  it("abuse: pressing Activate / Re-sync over and over still buys nothing", async () => {
    const { org, user } = await seed();
    const c = await newClient(org.id);
    for (let i = 0; i < 5; i++) {
      const r = await runProvision(actor(user), c.id);
      expect(r.ok).toBe(true);
      expect((r.data as { numberReserved: boolean }).numberReserved).toBe(true);
    }
    expect(purchases).toHaveLength(0);
    expect((await row(c.id))?.retellPhoneNumber).toBeNull();
  });

  it("an operator who signs up their own first business still gets a number", async () => {
    const { org, user } = await seed("operator");
    const c = await newClient(org.id, { status: "draft", trialEndsAt: null });
    await finishSignup(actor(user), c.id, { industry: null, seedFromPack: false, companySize: "solo" });
    expect(purchases).toEqual([c.id]);
  });
});

describe("what unlocks the number", () => {
  it("a card on file: an active subscription", async () => {
    const { org, user } = await seed();
    const c = await newClient(org.id);
    await runProvision(actor(user), c.id);
    expect(purchases).toHaveLength(0);

    await db.insert(schema.subscriptions).values({ clientId: c.id, status: "active", plan: "starter" });
    const r = await runProvision(actor(user), c.id);
    expect((r.data as { phoneNumber: string }).phoneNumber).toMatch(/^\+1415555/);
    expect(purchases).toEqual([c.id]);
  });

  it("the Stripe webhook path hands the number over by itself after payment", async () => {
    const { org, user } = await seed();
    const c = await newClient(org.id);
    await runProvision(actor(user), c.id); // agent only
    await db.insert(schema.subscriptions).values({ clientId: c.id, status: "active", plan: "starter" });
    await provisionNumberAfterPayment(c.id);
    expect((await row(c.id))?.retellPhoneNumber).toMatch(/^\+1415555/);
    // A replayed webhook doesn't buy a second one.
    await provisionNumberAfterPayment(c.id);
    expect(purchases).toEqual([c.id]);
  });

  it("the webhook path never buys for an unpaid business, or one with no agent yet", async () => {
    const { org, user } = await seed();
    const unpaid = await newClient(org.id);
    await runProvision(actor(user), unpaid.id);
    await provisionNumberAfterPayment(unpaid.id);
    const noAgent = await newClient(org.id);
    await db.insert(schema.subscriptions).values({ clientId: noAgent.id, status: "active" });
    await provisionNumberAfterPayment(noAgent.id);
    expect(purchases).toHaveLength(0);
  });

  it("finished guided setup (which includes the test call) buys exactly one number", async () => {
    const { org, user } = await seed();
    const c = await newClient(org.id);
    await finishGuidedSetup(c.id, { testCall: true });
    const r = await runProvision(actor(user), c.id);
    expect((r.data as { phoneNumber: string }).phoneNumber).toMatch(/^\+1415555/);
    expect(purchases).toEqual([c.id]);
  });

  it("comped businesses and operator-approved trials get a number straight away", async () => {
    const { org, user } = await seed();
    const comped = await newClient(org.id, { status: "live", trialEndsAt: null, setupFlags: { comped: true } });
    const approved = await newClient(org.id, { setupFlags: { trialApprovedAt: new Date().toISOString() } });
    await runProvision(actor(user), comped.id);
    await runProvision(actor(user), approved.id);
    expect(purchases).toEqual([comped.id, approved.id]);
  });

  it("a saved card (Stripe trial) unlocks it, and the webhook hands it over by itself", async () => {
    const { org, user } = await seed();
    const c = await newClient(org.id);
    await runProvision(actor(user), c.id); // agent only
    expect(purchases).toHaveLength(0);
    await db.insert(schema.subscriptions).values({ clientId: c.id, status: "trialing", plan: "starter" });
    await provisionNumberAfterPayment(c.id);
    await provisionNumberAfterPayment(c.id); // replay
    expect(purchases).toEqual([c.id]);
    // A card-unlocked number doesn't count toward the trial cap.
    expect((await row(c.id))?.setupFlags?.trialNumberAt).toBeUndefined();
  });

  it("invoice events missing: an active subscription with no recorded payment still gets its number", async () => {
    const { org, user } = await seed();
    const c = await newClient(org.id);
    await runProvision(actor(user), c.id);
    await db.insert(schema.subscriptions).values({ clientId: c.id, status: "active", plan: "starter", firstPaidAt: null });
    await provisionNumberAfterPayment(c.id);
    expect(purchases).toEqual([c.id]);
  });

  it("a recorded payment unlocks it even if the subscription has since gone past due", async () => {
    const { org, user } = await seed();
    const c = await newClient(org.id);
    await runProvision(actor(user), c.id);
    await db
      .insert(schema.subscriptions)
      .values({ clientId: c.id, status: "past_due", plan: "starter", firstPaidAt: new Date() });
    await runProvision(actor(user), c.id);
    expect(purchases).toEqual([c.id]);
  });

  it("operators can always provision a client by hand", async () => {
    const { org, user } = await seed("operator");
    const c = await newClient(org.id, { status: "draft", trialEndsAt: null });
    await runProvision(actor(user), c.id);
    expect(purchases).toEqual([c.id]);
  });

  it("abuse: once unlocked, concurrent clicks buy exactly one number", async () => {
    const { org, user } = await seed();
    const c = await newClient(org.id);
    await db.insert(schema.subscriptions).values({ clientId: c.id, status: "active" });
    const results = await Promise.all([
      runProvision(actor(user), c.id),
      runProvision(actor(user), c.id),
      runProvision(actor(user), c.id),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(purchases).toEqual([c.id]);
  });

  it("an existing number is just re-bound — never a second purchase", async () => {
    const { org, user } = await seed();
    const c = await newClient(org.id, { retellPhoneNumber: "+14155550100", retellAgentId: "agent_x" });
    await runProvision(actor(user), c.id);
    expect(purchases).toHaveLength(0);
    expect((await row(c.id))?.retellPhoneNumber).toBe("+14155550100");
  });
});

describe("free trials get a number after their first test call", () => {
  it("the test call unlocks it: the Retell webhook path hands it over, once", async () => {
    const { org, user } = await seed();
    const c = await newClient(org.id, { status: "draft", trialEndsAt: null });
    await finishSignup(actor(user), c.id, { industry: "barber", seedFromPack: false, companySize: "solo" });
    expect(purchases).toHaveLength(0);

    await testCall(c.id);
    await provisionNumberIfUnlocked(c.id);
    await provisionNumberIfUnlocked(c.id); // a replayed call_ended
    expect(purchases).toEqual([c.id]);
    const after = await row(c.id);
    expect(after?.retellPhoneNumber).toMatch(/^\+1415555/);
    // Stamped for the daily cap.
    expect(after?.setupFlags?.trialNumberAt).toBeTruthy();
  });

  it("the same unlock from the page: Get my phone number buys exactly one, even with concurrent clicks", async () => {
    const { org, user } = await seed();
    const c = await newClient(org.id);
    await runProvision(actor(user), c.id); // agent only
    await testCall(c.id);
    const results = await Promise.all([
      runProvision(actor(user), c.id),
      runProvision(actor(user), c.id),
      runProvision(actor(user), c.id),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(purchases).toEqual([c.id]);
  });

  it("without a test call, the page says what to do next", async () => {
    const { org, user } = await seed();
    const c = await newClient(org.id);
    const r = await runProvision(actor(user), c.id);
    expect(r.data).toMatchObject({ numberReserved: true, reservedReason: "needs_test_call" });
    await provisionNumberIfUnlocked(c.id);
    expect(purchases).toHaveLength(0);
  });

  it("an ended trial, or one whose number was already released, never gets one", async () => {
    const { org, user } = await seed();
    const ended = await newClient(org.id, {
      trialEndsAt: new Date(Date.now() - 86_400_000),
      retellAgentId: "agent_e",
    });
    const lapsed = await newClient(org.id, {
      status: "paused",
      trialEndsAt: new Date(Date.now() - 5 * 86_400_000),
      retellAgentId: "agent_l",
      setupFlags: { trialLapsedAt: new Date().toISOString() },
    });
    for (const c of [ended, lapsed]) {
      await testCall(c.id);
      await provisionNumberIfUnlocked(c.id);
      await runProvision(actor(user), c.id);
    }
    expect(purchases).toHaveLength(0);
  });

  it("abuse: the daily cap stops a burst of trial signups from buying more than TRIAL_NUMBERS_PER_DAY", async () => {
    const { org, user } = await seed();
    const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    // Numbers already bought for trials in the last 24 hours.
    for (let i = 0; i < TRIAL_NUMBERS_PER_DAY; i++) {
      await newClient(org.id, { retellPhoneNumber: `+1415000${String(1000 + i)}`, setupFlags: { trialNumberAt: recent } });
    }
    const c = await newClient(org.id);
    await runProvision(actor(user), c.id);
    await testCall(c.id);
    const r = await runProvision(actor(user), c.id);
    expect(r.data).toMatchObject({ numberReserved: true, reservedReason: "daily_cap" });
    expect(purchases).toHaveLength(0);

    // A paying business is never held by the trial cap.
    await db.insert(schema.subscriptions).values({ clientId: c.id, status: "active", plan: "starter" });
    await runProvision(actor(user), c.id);
    expect(purchases).toEqual([c.id]);
  });

  it("numbers older than 24 hours don't count toward the cap", async () => {
    const { org, user } = await seed();
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    for (let i = 0; i < TRIAL_NUMBERS_PER_DAY; i++) {
      await newClient(org.id, { retellPhoneNumber: `+1415000${String(2000 + i)}`, setupFlags: { trialNumberAt: old } });
    }
    const c = await newClient(org.id);
    await testCall(c.id);
    await runProvision(actor(user), c.id);
    expect(purchases).toEqual([c.id]);
  });
});
