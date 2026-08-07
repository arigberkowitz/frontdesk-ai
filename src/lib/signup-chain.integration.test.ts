import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

/**
 * The self-serve signup chain, run end to end against a real database.
 *
 * Everything from "a stranger fills in the form" to "they can switch their
 * receptionist on" was assembled from pieces that were each individually
 * correct and had never once been executed in order. That is exactly the shape
 * of the two bugs that turned up an hour after shipping it — the comp code was
 * unreachable, and the screen holding it never rendered — and neither would
 * have survived a single run of this.
 *
 * Skipped unless INTEGRATION_DB points at a throwaway Postgres, because it
 * writes rows. Run it with:
 *   INTEGRATION_DB=1 DATABASE_URL=postgresql://…/scratch npx vitest run \
 *     src/lib/signup-chain.integration.test.ts
 */

const RUN = Boolean(process.env.INTEGRATION_DB);
const DAY = 24 * 60 * 60 * 1000;

describe.skipIf(!RUN)("a business signing itself up", () => {
  let db: typeof import("@/db").db;
  let schema: typeof import("@/db/schema");
  let createClient: typeof import("@/lib/data/clients").createClient;
  let seedClientFromPack: typeof import("@/lib/starter-seed").seedClientFromPack;
  let getTrialState: typeof import("@/lib/data/trial").getTrialState;
  let clientMayActivate: typeof import("@/lib/data/trial").clientMayActivate;
  let orgId: string;
  let clientId: string;

  beforeAll(async () => {
    ({ db } = await import("@/db"));
    schema = await import("@/db/schema");
    ({ createClient } = await import("@/lib/data/clients"));
    ({ seedClientFromPack } = await import("@/lib/starter-seed"));
    ({ getTrialState, clientMayActivate } = await import("@/lib/data/trial"));

    const [org] = await db
      .insert(schema.organizations)
      .values({ name: "Chain test", kind: "business" })
      .returning();
    orgId = org!.id;
  });

  afterAll(async () => {
    if (orgId) await db.delete(schema.organizations).where(eq(schema.organizations.id, orgId));
  });

  it("starts as a draft with nothing switched on", async () => {
    const client = await createClient(orgId, {
      name: "Nick's Barbershop",
      websiteUrl: null,
      timezone: "America/Los_Angeles",
    });
    clientId = client.id;
    expect(client.status).toBe("draft");
    expect(await clientMayActivate(clientId)).toBe(false);
  });

  // The exact write onboardFromWebsitePortalAction performs after creating the
  // business. If this drifts from the action, the test is worthless — so it is
  // deliberately the same three fields, in the same shape.
  it("is put on a 21-day trial by finishing onboarding", async () => {
    const { TRIAL_DAYS } = await import("@/config/plans");
    expect(TRIAL_DAYS).toBe(21);
    await db
      .update(schema.clients)
      .set({
        companySize: "solo",
        industry: "Barbershop / Salon",
        status: "trial",
        trialEndsAt: new Date(Date.now() + TRIAL_DAYS * DAY),
        setupFlags: { intendedPlan: "pro" },
      })
      .where(eq(schema.clients.id, clientId));

    const state = await getTrialState(clientId);
    expect(state.active).toBe(true);
    expect(state.expired).toBe(false);
    expect(state.comped).toBe(false);
    expect(state.subscribed).toBe(false);
    // Twenty full days remaining on day one — the twenty-first is today.
    expect(state.daysLeft).toBe(TRIAL_DAYS - 1);
  });

  // The failure this catches is the one that cost a whole evening: everyone
  // arrives on a trial now, and anything that treats "on a trial" as "already
  // sorted" locks them out of the thing they came for.
  it("can switch its receptionist on straight away", async () => {
    expect(await clientMayActivate(clientId)).toBe(true);
  });

  it("carries the plan they clicked on the pricing page", async () => {
    const row = await db.query.clients.findFirst({ where: eq(schema.clients.id, clientId) });
    expect(row?.setupFlags?.intendedPlan).toBe("pro");
  });

  it("lands with a receptionist that has something to say", async () => {
    await seedClientFromPack(orgId, clientId, "Barbershop / Salon");
    const [services, hours, knowledge] = await Promise.all([
      db.query.services.findMany({ where: eq(schema.services.clientId, clientId) }),
      db.query.businessHours.findMany({ where: eq(schema.businessHours.clientId, clientId) }),
      db.query.knowledgeItems.findMany({ where: eq(schema.knowledgeItems.clientId, clientId) }),
    ]);
    expect(services.length).toBeGreaterThan(0);
    expect(hours.length).toBe(7);
    expect(knowledge.length).toBeGreaterThan(0);
  });

  it("stops being able to activate once the trial runs out", async () => {
    await db
      .update(schema.clients)
      .set({ trialEndsAt: new Date(Date.now() - DAY) })
      .where(eq(schema.clients.id, clientId));

    const state = await getTrialState(clientId);
    expect(state.expired).toBe(true);
    expect(state.active).toBe(false);
    expect(await clientMayActivate(clientId)).toBe(false);
  });

  // "Put on the house" — the write compClientAction performs.
  it("is free forever once you comp it, expired trial or not", async () => {
    const before = await db.query.clients.findFirst({ where: eq(schema.clients.id, clientId) });
    await db
      .update(schema.clients)
      .set({
        status: "live",
        trialEndsAt: null,
        trialRequestedAt: null,
        setupFlags: { ...(before?.setupFlags ?? {}), comped: true },
      })
      .where(eq(schema.clients.id, clientId));

    const state = await getTrialState(clientId);
    expect(state.comped).toBe(true);
    expect(state.expired).toBe(false);
    expect(state.active).toBe(false);
    expect(await clientMayActivate(clientId)).toBe(true);
    // Comping must not wipe what they'd already chosen.
    const after = await db.query.clients.findFirst({ where: eq(schema.clients.id, clientId) });
    expect(after?.setupFlags?.intendedPlan).toBe("pro");
  });
});
