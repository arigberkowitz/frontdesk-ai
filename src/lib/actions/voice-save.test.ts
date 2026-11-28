import { beforeEach, describe, expect, it, vi } from "vitest";

/** The portal Save button: Retell first, DB second, never an xAI voice. */
const m = vi.hoisted(() => ({
  client: { id: "c1", name: "Lawyers for justice", voiceId: "11labs-Marissa", retellAgentId: "ag_1", languages: "en-es" } as Record<string, unknown> | null,
  updateClient: vi.fn(async (..._a: unknown[]) => ({})),
  updateAgentVoice: vi.fn(async (..._a: unknown[]) => undefined),
  applyClientEdit: vi.fn(async () => "synced" as const),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth-guard", () => ({
  requireClientEditor: async () => ({ ok: true, user: { id: "u1", role: "client_admin", orgId: "o1" } }),
}));
vi.mock("@/lib/data/clients", () => ({
  assertClientInOrg: async () => undefined,
  getClient: async () => m.client,
  updateClient: (...a: unknown[]) => m.updateClient(...a),
}));
vi.mock("@/lib/data/setup-review", () => ({ markSetupReviewed: vi.fn() }));
vi.mock("@/lib/agent-publish", () => ({ applyClientEdit: m.applyClientEdit, withSyncNote: (s: string) => s }));
vi.mock("@/lib/retell", () => ({ updateAgentVoice: (...a: unknown[]) => m.updateAgentVoice(...a) }));
vi.mock("@/lib/env", () => ({ integrations: { retell: () => true } }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const { setVoiceByIdAction } = await import("./guidelines");

function form(voiceId: string, voiceName?: string) {
  const f = new FormData();
  f.set("clientId", "c1");
  f.set("voiceId", voiceId);
  if (voiceName) f.set("voiceName", voiceName);
  return f;
}

const baseClient = {
  id: "c1",
  name: "Lawyers for justice",
  voiceId: "11labs-Marissa",
  retellAgentId: "ag_1",
  languages: "en-es",
};

beforeEach(() => {
  m.client = { ...baseClient };
  m.updateClient.mockClear();
  m.updateAgentVoice.mockReset();
  m.updateAgentVoice.mockResolvedValue(undefined);
  m.applyClientEdit.mockClear();
  m.applyClientEdit.mockResolvedValue("synced");
});

describe("setVoiceByIdAction", () => {
  it("rejects an xAI speech-to-speech voice without touching Retell or the DB", async () => {
    const r = await setVoiceByIdAction({}, form("xai-Ara"));
    expect(r.ok).toBe(false);
    expect(m.updateAgentVoice).not.toHaveBeenCalled();
    expect(m.updateClient).not.toHaveBeenCalled();
  });

  it("updates the live agent, then saves", async () => {
    const r = await setVoiceByIdAction({}, form("11labs-Adrian"));
    expect(r.ok).toBe(true);
    expect(m.updateAgentVoice).toHaveBeenCalledWith("ag_1", "11labs-Adrian", "en-es");
    expect(m.updateClient).toHaveBeenCalledWith("o1", "c1", { voiceId: "11labs-Adrian", agentName: "Adrian" });
    expect(m.applyClientEdit).toHaveBeenCalled();
    expect(r.message).toMatch(/introduces themselves as Adrian/);
  });

  it("keeps the old voice saved when Retell rejects the new one", async () => {
    m.updateAgentVoice.mockRejectedValue(new Error("400 nope"));
    const r = await setVoiceByIdAction({}, form("11labs-Adrian"));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/current voice is unchanged/);
    expect(m.updateClient).not.toHaveBeenCalled();
  });

  it("a business with no agent yet just saves", async () => {
    m.client = { ...baseClient, voiceId: null, retellAgentId: null };
    const r = await setVoiceByIdAction({}, form("11labs-Adrian"));
    expect(r.ok).toBe(true);
    expect(m.updateAgentVoice).not.toHaveBeenCalled();
    expect(m.updateClient).toHaveBeenCalled();
  });

  it("lets a business stuck on an xAI voice switch away from it", async () => {
    m.client = { ...baseClient, voiceId: "xai-Ara" };
    const r = await setVoiceByIdAction({}, form("11labs-Marissa", "Marissa"));
    expect(r.ok).toBe(true);
    expect(m.updateClient).toHaveBeenCalledWith("o1", "c1", { voiceId: "11labs-Marissa", agentName: "Marissa" });
  });
});

describe("setVoiceByIdAction language compatibility", () => {
  it("rejects cartesia-Allie on a multilingual agent without touching Retell or the DB", async () => {
    const r = await setVoiceByIdAction({}, form("cartesia-Allie"));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/languages this receptionist speaks/);
    expect(m.updateAgentVoice).not.toHaveBeenCalled();
    expect(m.updateClient).not.toHaveBeenCalled();
  });

  it("an English-only agent can switch to a Cartesia voice", async () => {
    m.client = { ...baseClient, languages: "en" };
    const r = await setVoiceByIdAction({}, form("cartesia-Allie", "Allie"));
    expect(r.ok).toBe(true);
    expect(m.updateAgentVoice).toHaveBeenCalledWith("ag_1", "cartesia-Allie", "en");
    expect(m.updateClient).toHaveBeenCalledWith("o1", "c1", { voiceId: "cartesia-Allie", agentName: "Allie" });
  });

  it("keeps a custom agent name and still republishes the prompt", async () => {
    m.client = { ...baseClient, agentName: "Ava", greeting: "Hi, you've reached Ava, an AI assistant." };
    const r = await setVoiceByIdAction({}, form("11labs-Adrian", "Adrian"));
    expect(r.ok).toBe(true);
    expect(m.updateClient).toHaveBeenCalledWith("o1", "c1", { voiceId: "11labs-Adrian" });
    expect(m.applyClientEdit).toHaveBeenCalled();
    expect(r.message).toMatch(/name stays Ava/);
  });
});
