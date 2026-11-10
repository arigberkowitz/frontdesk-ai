import { beforeEach, describe, expect, it, vi } from "vitest";

/** The portal Save button: Retell first, DB second, never an xAI voice. */
const m = vi.hoisted(() => ({
  client: { id: "c1", voiceId: "11labs-Marissa", retellAgentId: "ag_1" } as Record<string, unknown> | null,
  updateClient: vi.fn(async (..._a: unknown[]) => ({})),
  updateAgentVoice: vi.fn(async (..._a: unknown[]) => undefined),
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
vi.mock("@/lib/agent-publish", () => ({ applyClientEdit: vi.fn(), withSyncNote: (s: string) => s }));
vi.mock("@/lib/retell", () => ({ updateAgentVoice: (...a: unknown[]) => m.updateAgentVoice(...a) }));
vi.mock("@/lib/env", () => ({ integrations: { retell: () => true } }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const { setVoiceByIdAction } = await import("./guidelines");

function form(voiceId: string) {
  const f = new FormData();
  f.set("clientId", "c1");
  f.set("voiceId", voiceId);
  return f;
}

beforeEach(() => {
  m.client = { id: "c1", voiceId: "11labs-Marissa", retellAgentId: "ag_1" };
  m.updateClient.mockClear();
  m.updateAgentVoice.mockReset();
  m.updateAgentVoice.mockResolvedValue(undefined);
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
    expect(m.updateAgentVoice).toHaveBeenCalledWith("ag_1", "11labs-Adrian");
    expect(m.updateClient).toHaveBeenCalledWith("o1", "c1", { voiceId: "11labs-Adrian" });
  });

  it("keeps the old voice saved when Retell rejects the new one", async () => {
    m.updateAgentVoice.mockRejectedValue(new Error("400 nope"));
    const r = await setVoiceByIdAction({}, form("11labs-Adrian"));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/current voice is unchanged/);
    expect(m.updateClient).not.toHaveBeenCalled();
  });

  it("a business with no agent yet just saves", async () => {
    m.client = { id: "c1", voiceId: null, retellAgentId: null };
    const r = await setVoiceByIdAction({}, form("11labs-Adrian"));
    expect(r.ok).toBe(true);
    expect(m.updateAgentVoice).not.toHaveBeenCalled();
    expect(m.updateClient).toHaveBeenCalled();
  });

  it("lets a business stuck on an xAI voice switch away from it", async () => {
    m.client = { id: "c1", voiceId: "xai-Ara", retellAgentId: "ag_1" };
    const r = await setVoiceByIdAction({}, form("11labs-Marissa"));
    expect(r.ok).toBe(true);
    expect(m.updateClient).toHaveBeenCalledWith("o1", "c1", { voiceId: "11labs-Marissa" });
  });
});
