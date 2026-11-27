import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * syncAgentPrompt and the trial hold: a free trial that ended unpaid
 * publishes the message-taking agent (no booking tools); paying — or a Stripe
 * trial — publishes the full one again. The subscription lookup is real SQL
 * (in-process Postgres); Retell is faked.
 */

vi.mock("@/db", async () => (await import("../../test/helpers/pglite-db")).pgliteDb());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const llmUpdate = vi.fn(async (_id: string, _body: { general_prompt: string; general_tools: { name: string }[] }) => ({}));
vi.mock("@/lib/retell", async (orig) => ({
  ...(await orig<typeof import("@/lib/retell")>()),
  getRetellClient: () => ({ llm: { update: llmUpdate }, agent: { update: vi.fn(async () => ({})) } }),
}));
vi.mock("@/lib/env", async (orig) => {
  const real = await orig<typeof import("@/lib/env")>();
  return { ...real, integrations: { ...real.integrations, retell: () => true } };
});
let current: Record<string, unknown> = {};
vi.mock("@/lib/data/clients", () => ({ getClient: vi.fn(async () => current) }));

const { db } = await import("@/db");
const schema = await import("@/db/schema");
const { syncAgentPrompt } = await import("./agent-publish");

const DAY = 86_400_000;
let clientId = "";

beforeEach(async () => {
  llmUpdate.mockClear();
  await db.delete(schema.subscriptions);
  await db.delete(schema.clients);
  const [org] = await db.insert(schema.organizations).values({ name: "House", kind: "agency" }).returning();
  const [c] = await db
    .insert(schema.clients)
    .values({ orgId: org!.id, name: "Nick's Barbershop", status: "trial", retellLlmId: "llm_1" })
    .returning();
  clientId = c!.id;
  current = {
    id: clientId,
    orgId: org!.id,
    name: "Nick's Barbershop",
    industry: "barbershop",
    status: "trial",
    trialEndsAt: new Date(Date.now() - DAY),
    retellLlmId: "llm_1",
    retellAgentId: null,
    timezone: "America/New_York",
    languages: "en",
    answeringMode: "all_calls",
    staffModeEnabled: false,
    services: [],
    businessHours: [],
    knowledgeItems: [],
    providers: [],
    setupFlags: {},
  };
});

const published = () => llmUpdate.mock.calls.at(-1)![1];
const toolNames = () => published().general_tools.map((t) => t.name);
const messageOnly = () => /TEMPORARILY TURNED OFF/.test(published().general_prompt);

describe("syncAgentPrompt on an ended, unpaid trial", () => {
  it("publishes the message-taking agent, with no booking tools", async () => {
    expect(await syncAgentPrompt("org", clientId)).toBe(true);
    expect(messageOnly()).toBe(true);
    for (const n of toolNames()) expect(["take_message", "transfer_to_human", "transfer_emergency"]).toContain(n);
  });

  it("a running trial gets the full agent", async () => {
    current = { ...current, trialEndsAt: new Date(Date.now() + DAY) };
    await syncAgentPrompt("org", clientId);
    expect(messageOnly()).toBe(false);
  });

  it("an active subscription or a Stripe trial gets the full agent", async () => {
    for (const status of ["active", "trialing"] as const) {
      await db.delete(schema.subscriptions);
      await db.insert(schema.subscriptions).values({ clientId, status, plan: "starter" });
      await syncAgentPrompt("org", clientId);
      expect(messageOnly()).toBe(false);
    }
  });

  it("a soft-deleted subscription doesn't count as paying", async () => {
    await db.insert(schema.subscriptions).values({ clientId, status: "active", plan: "starter", deletedAt: new Date() });
    await syncAgentPrompt("org", clientId);
    expect(messageOnly()).toBe(true);
  });

  it("comped businesses get the full agent", async () => {
    current = { ...current, setupFlags: { comped: true } };
    await syncAgentPrompt("org", clientId);
    expect(messageOnly()).toBe(false);
  });

  it("once live (paid), the full agent", async () => {
    current = { ...current, status: "live" };
    await syncAgentPrompt("org", clientId);
    expect(messageOnly()).toBe(false);
  });
});

describe("syncAgentPrompt on a live plan whose subscription ended", () => {
  beforeEach(() => {
    current = { ...current, status: "live", trialEndsAt: null };
  });

  it("canceled → the message-taking agent", async () => {
    await db.insert(schema.subscriptions).values({ clientId, status: "canceled", plan: "starter" });
    await syncAgentPrompt("org", clientId);
    expect(messageOnly()).toBe(true);
  });

  it("Stripe 'unpaid' (past_due + flag) → message-taking; plain past_due (still retrying) → full agent", async () => {
    await db.insert(schema.subscriptions).values({ clientId, status: "past_due", plan: "starter" });
    await syncAgentPrompt("org", clientId);
    expect(messageOnly()).toBe(false);
    current = { ...current, setupFlags: { stripeUnpaidAt: new Date().toISOString() } };
    await syncAgentPrompt("org", clientId);
    expect(messageOnly()).toBe(true);
  });

  it("live with no subscription at all (an off-Stripe deal) keeps the full agent", async () => {
    await syncAgentPrompt("org", clientId);
    expect(messageOnly()).toBe(false);
  });
});
