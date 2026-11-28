import { beforeEach, describe, expect, it, vi } from "vitest";

/** Operator agent-tab saves must republish, and must never buy a number. */

const m = vi.hoisted(() => ({
  client: null as Record<string, unknown> | null,
  updateClient: vi.fn(async (..._a: unknown[]) => ({})),
  updateAgentVoice: vi.fn(async (..._a: unknown[]) => undefined),
  applyClientEdit: vi.fn(async (_user: { orgId: string }, _clientId: string): Promise<"synced" | "failed" | "not_provisioned"> => "synced"),
  createAgentVersion: vi.fn(async (..._a: unknown[]) => ({})),
  runProvision: vi.fn(async () => ({ ok: true })),
  planAccessFor: vi.fn(async () => ({ has: () => false })),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth-guard", () => ({
  requireOperator: async () => ({ id: "u1", role: "operator", orgId: "o1" }),
  requireClientEditor: async () => ({ ok: true, user: { id: "u1", role: "operator", orgId: "o1" } }),
}));
vi.mock("@/lib/data/clients", () => ({
  assertClientInOrg: async () => undefined,
  getClient: async () => m.client,
  updateClient: m.updateClient,
}));
vi.mock("@/lib/data/agent-versions", () => ({
  createAgentVersion: m.createAgentVersion,
}));
vi.mock("@/lib/agent-publish", async (orig) => {
  const real = await orig<typeof import("@/lib/agent-publish")>();
  return {
    ...real,
    applyClientEdit: m.applyClientEdit,
    buildPromptForClient: () => "PROMPT",
  };
});
vi.mock("@/lib/retell", () => ({
  DEFAULT_VOICE_ID: "11labs-Marissa",
  updateAgentVoice: m.updateAgentVoice,
}));
vi.mock("@/lib/env", async (orig) => {
  const real = await orig<typeof import("@/lib/env")>();
  return { ...real, integrations: { ...real.integrations, retell: () => true } };
});
vi.mock("@/lib/plan-access", () => ({ planAccessFor: m.planAccessFor }));
vi.mock("@/lib/provision", () => ({
  OWNER_PHONE_ERROR: "phone error",
  runProvision: m.runProvision,
}));
vi.mock("@/lib/data/trial", () => ({ clientMayActivate: async () => true }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const { saveAgentConfigAction, publishAgentAction } = await import("./agent");

function configForm(extra: Record<string, string> = {}) {
  const f = new FormData();
  f.set("clientId", "c1");
  f.set("greeting", "Hi, thanks for calling Nick's.");
  f.set("agentName", "Riley");
  f.set("voiceId", "11labs-Adrian");
  f.set("escalationNumber", "");
  f.set("recordingDisclosureEnabled", "on");
  f.set("recordingDisclosureLine", "");
  f.set("agentGuidance", "Never quote exact prices.");
  f.set("bookingInstructions", "Only book haircuts.");
  for (const [k, v] of Object.entries(extra)) f.set(k, v);
  return f;
}

const baseClient = {
  id: "c1",
  orgId: "o1",
  name: "Nick's Barbershop",
  voiceId: "11labs-Marissa",
  retellAgentId: "ag_1",
  retellLlmId: "llm_1",
  languages: "en",
  knowledgeItems: [],
};

beforeEach(() => {
  m.client = { ...baseClient };
  m.updateClient.mockClear();
  m.updateAgentVoice.mockReset();
  m.updateAgentVoice.mockResolvedValue(undefined);
  m.applyClientEdit.mockReset();
  m.applyClientEdit.mockResolvedValue("synced");
  m.createAgentVersion.mockClear();
  m.runProvision.mockClear();
});

describe("saveAgentConfigAction", () => {
  it("saves to the database and republishes the live prompt", async () => {
    const result = await saveAgentConfigAction({}, configForm());
    expect(m.updateClient).toHaveBeenCalledWith(
      "o1",
      "c1",
      expect.objectContaining({
        greeting: "Hi, thanks for calling Nick's.",
        agentName: "Riley",
        agentGuidance: "Never quote exact prices.",
        bookingInstructions: "Only book haircuts.",
      }),
    );
    expect(m.applyClientEdit).toHaveBeenCalledWith({ id: "u1", role: "operator", orgId: "o1" }, "c1");
    expect(m.runProvision).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.message).toBe("Saved.");
  });

  it("still succeeds when the live push fails, and says so", async () => {
    m.applyClientEdit.mockResolvedValue("failed");
    const result = await saveAgentConfigAction({}, configForm({ voiceId: "11labs-Marissa" }));
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/couldn't update the live receptionist/i);
    expect(m.runProvision).not.toHaveBeenCalled();
  });

  it("does not treat a missing agent as a failed save", async () => {
    m.client = { ...baseClient, retellAgentId: null, retellLlmId: null };
    m.applyClientEdit.mockResolvedValue("not_provisioned");
    const result = await saveAgentConfigAction({}, configForm({ voiceId: "11labs-Marissa" }));
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/once your AI is activated/i);
  });
});

describe("publishAgentAction (Retry)", () => {
  it("snapshots a version after a successful retry", async () => {
    const f = new FormData();
    f.set("clientId", "c1");
    const result = await publishAgentAction({}, f);
    expect(m.applyClientEdit).toHaveBeenCalled();
    expect(m.createAgentVersion).toHaveBeenCalled();
    expect(m.runProvision).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/up to date/i);
  });

  it("does not snapshot when the retry fails", async () => {
    m.applyClientEdit.mockResolvedValue("failed");
    const f = new FormData();
    f.set("clientId", "c1");
    const result = await publishAgentAction({}, f);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/couldn't update the live receptionist/i);
    expect(m.createAgentVersion).not.toHaveBeenCalled();
    expect(m.runProvision).not.toHaveBeenCalled();
  });
});
