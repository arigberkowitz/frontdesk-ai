import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

/**
 * applyClientEdit: one automatic retry on a Retell error, a persisted
 * failed/cleared flag, and honest withSyncNote copy. Retell is faked;
 * the flag write goes to in-process Postgres.
 */

vi.mock("@/db", async () => (await import("../../test/helpers/pglite-db")).pgliteDb());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/plan-access", () => ({ planAccessFor: async () => ({ has: () => false }) }));

const llmUpdate = vi.fn(
  async (_id: string, _body: { general_prompt: string; general_tools: { name: string }[] }) => ({}),
);
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
const { applyClientEdit, withSyncNote } = await import("./agent-publish");

function flagsOf(id: string) {
  return db
    .select({ setupFlags: schema.clients.setupFlags })
    .from(schema.clients)
    .where(eq(schema.clients.id, id))
    .then((rows) => rows[0]?.setupFlags ?? {});
}

let clientId = "";

beforeEach(async () => {
  llmUpdate.mockReset();
  llmUpdate.mockResolvedValue({});
  await db.delete(schema.subscriptions);
  await db.delete(schema.clients);
  const [org] = await db.insert(schema.organizations).values({ name: "House", kind: "agency" }).returning();
  const [c] = await db
    .insert(schema.clients)
    .values({ orgId: org!.id, name: "Nick's Barbershop", status: "live", retellLlmId: "llm_1", retellAgentId: "ag_1" })
    .returning();
  clientId = c!.id;
  current = {
    id: clientId,
    orgId: org!.id,
    name: "Nick's Barbershop",
    industry: "barbershop",
    status: "live",
    trialEndsAt: null,
    retellLlmId: "llm_1",
    retellAgentId: "ag_1",
    timezone: "America/Los_Angeles",
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

describe("withSyncNote", () => {
  it("leaves a successful save alone", () => {
    expect(withSyncNote("Saved.", "synced")).toBe("Saved.");
  });

  it("explains when there is no live agent yet", () => {
    expect(withSyncNote("Saved.", "not_provisioned")).toBe("Saved. It'll apply once your AI is activated.");
  });

  it("points at Retry when the live push failed", () => {
    const note = withSyncNote("Saved.", "failed");
    expect(note).toContain("Saved.");
    expect(note).toMatch(/couldn't update the live receptionist/i);
    expect(note).toMatch(/Retry/i);
  });
});

describe("applyClientEdit", () => {
  const user = { orgId: "org" };

  it("returns synced and clears the failure flag", async () => {
    expect(await applyClientEdit(user, clientId)).toBe("synced");
    expect(llmUpdate).toHaveBeenCalledTimes(1);
    expect((await flagsOf(clientId)).agentSyncFailedAt ?? null).toBeNull();
  });

  it("retries once after a Retell error, then succeeds", async () => {
    llmUpdate.mockRejectedValueOnce(new Error("retell down")).mockResolvedValueOnce({});
    expect(await applyClientEdit(user, clientId)).toBe("synced");
    expect(llmUpdate).toHaveBeenCalledTimes(2);
    expect((await flagsOf(clientId)).agentSyncFailedAt ?? null).toBeNull();
  });

  it("records a failure after two Retell errors, without throwing", async () => {
    llmUpdate.mockRejectedValue(new Error("retell down"));
    expect(await applyClientEdit(user, clientId)).toBe("failed");
    expect(llmUpdate).toHaveBeenCalledTimes(2);
    expect((await flagsOf(clientId)).agentSyncFailedAt).toBeTruthy();
  });

  it("does not record a failure when the client is not provisioned", async () => {
    current = { ...current, retellLlmId: null, retellAgentId: null };
    expect(await applyClientEdit(user, clientId)).toBe("not_provisioned");
    expect(llmUpdate).not.toHaveBeenCalled();
    expect((await flagsOf(clientId)).agentSyncFailedAt ?? null).toBeNull();
  });
});
