import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Prod, Nov 10 2026: "400 Voice xai-Ara is only supported with xai
 * speech-to-speech models." A business had saved an xAI voice, and every
 * Activate / re-provision then failed for it. These pin the guards.
 */
const m = vi.hoisted(() => ({
  agentUpdate: vi.fn(async (..._a: unknown[]) => ({})),
  agentCreate: vi.fn(async (..._a: unknown[]) => ({ agent_id: "ag_new" })),
  llmUpdate: vi.fn(async (..._a: unknown[]) => ({})),
  phoneUpdate: vi.fn(async (..._a: unknown[]) => ({})),
  voiceList: vi.fn(async () => [
    { voice_id: "11labs-Marissa", voice_name: "Marissa", provider: "elevenlabs", gender: "female" },
    { voice_id: "xai-Ara", voice_name: "Ara", provider: "xai", gender: "female" },
    { voice_id: "xai-Altair", voice_name: "Altair", gender: "male" },
  ]),
}));

vi.mock("retell-sdk", () => ({
  default: class {
    agent = { update: m.agentUpdate, create: m.agentCreate };
    llm = { update: m.llmUpdate, create: vi.fn(async () => ({ llm_id: "llm_new" })) };
    phoneNumber = { update: m.phoneUpdate, create: vi.fn() };
    voice = { list: m.voiceList };
  },
}));
vi.mock("./env", () => ({
  env: { RETELL_API_KEY: "test", APP_URL: "https://example.test", AGENT_TOOL_SECRET: "x" },
  integrations: { retell: () => true },
}));
vi.mock("./agent-tool-token", () => ({ agentToolHeaders: () => ({}) }));

const { provisionAgentForClient, updateAgentVoice, listRetellVoices, DEFAULT_VOICE_ID } = await import("./retell");

const base = {
  clientId: "c1",
  agentName: "Ava",
  generalPrompt: "p",
  appUrl: "https://example.test",
  webhookUrl: "https://example.test/api/webhooks/retell",
  existingLlmId: "llm_1",
  existingPhoneNumber: "+15555550100",
};

beforeEach(() => {
  m.agentUpdate.mockClear();
  m.agentCreate.mockClear();
});

describe("provisionAgentForClient voice guard", () => {
  it("keeps the live voice (sends no voice_id) when the saved one is an xAI voice", async () => {
    await provisionAgentForClient({ ...base, existingAgentId: "ag_1", voiceId: "xai-Ara" });
    const body = m.agentUpdate.mock.calls[0][1] as Record<string, unknown>;
    expect(body).not.toHaveProperty("voice_id");
    expect(body.response_engine).toEqual({ type: "retell-llm", llm_id: "llm_1" });
  });

  it("a brand-new agent with an xAI voice gets the default voice", async () => {
    await provisionAgentForClient({ ...base, existingAgentId: null, voiceId: "xai-Ara" });
    expect((m.agentCreate.mock.calls[0][0] as Record<string, unknown>).voice_id).toBe(DEFAULT_VOICE_ID);
  });

  it("still sends a normal saved voice", async () => {
    await provisionAgentForClient({ ...base, existingAgentId: "ag_1", voiceId: "11labs-Adrian" });
    expect((m.agentUpdate.mock.calls[0][1] as Record<string, unknown>).voice_id).toBe("11labs-Adrian");
  });
});

describe("updateAgentVoice / listRetellVoices", () => {
  it("refuses an xAI voice before calling Retell", async () => {
    await expect(updateAgentVoice("ag_1", "xai-Ara")).rejects.toThrow();
    expect(m.agentUpdate).not.toHaveBeenCalled();
  });
  it("hides xAI voices from the picker list", async () => {
    expect((await listRetellVoices()).map((v) => v.voiceId)).toEqual(["11labs-Marissa"]);
  });
});
