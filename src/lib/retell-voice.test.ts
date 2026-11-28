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

const {
  provisionAgentForClient,
  updateAgentVoice,
  listRetellVoices,
  createWebCall,
  agentVoiceUpdateBody,
  _clearRetellVoicesCache,
  DEFAULT_VOICE_ID,
} = await import("./retell");

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
  m.voiceList.mockClear();
  _clearRetellVoicesCache();
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

describe("agentVoiceUpdateBody", () => {
  it("pins eleven_flash_v2_5 when a multilingual agent switches to an ElevenLabs voice", () => {
    expect(agentVoiceUpdateBody("11labs-Allie", "en-es")).toEqual({
      voice_id: "11labs-Allie",
      voice_model: "eleven_flash_v2_5",
    });
  });

  it("clears voice_model on English-only agents so Cartesia/OpenAI can save", () => {
    expect(agentVoiceUpdateBody("cartesia-Allie", "en")).toEqual({
      voice_id: "cartesia-Allie",
      voice_model: null,
    });
  });

  it("refuses a Cartesia voice on a multilingual agent before calling Retell", async () => {
    await expect(updateAgentVoice("ag_1", "cartesia-Allie", "en-es")).rejects.toThrow(/multilingual/);
    expect(m.agentUpdate).not.toHaveBeenCalled();
  });

  it("sends the model alongside the voice id", async () => {
    await updateAgentVoice("ag_1", "11labs-Allie", "en,es,fr");
    expect(m.agentUpdate).toHaveBeenCalledWith("ag_1", {
      voice_id: "11labs-Allie",
      voice_model: "eleven_flash_v2_5",
    });
  });
});

describe("createWebCall (v3)", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("posts to /v3/create-web-call and returns connection details", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          call_id: "call_test_1",
          access_token: "tok_test",
          transport: "gateway",
          ice_servers: [{ urls: "stun:stun.example.test" }],
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    );
    const conn = await createWebCall("ag_1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.retellai.com/v3/create-web-call");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ agent_id: "ag_1" });
    expect(conn).toEqual({
      callId: "call_test_1",
      accessToken: "tok_test",
      transport: "gateway",
      iceServers: [{ urls: "stun:stun.example.test" }],
    });
  });

  it("surfaces Retell's error message without calling the deprecated v2 path", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          message: "Deprecated API usage is no longer supported: Create Web Call v2.",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      ),
    );
    await expect(createWebCall("ag_1")).rejects.toThrow(/400 Deprecated API usage/);
    const url = (fetchMock.mock.calls[0] as [string])[0];
    expect(url).toContain("/v3/create-web-call");
    expect(url).not.toContain("/v2/");
  });
});

describe("phone number binding", () => {
  it("binds the agent as inbound AND outbound, so 'Call my phone' can dial out (prod 27 Nov 2026: 400 No outbound agent id set up for phone number)", async () => {
    m.phoneUpdate.mockClear();
    await provisionAgentForClient({ ...base, existingAgentId: "ag_1" } as never);
    const body = m.phoneUpdate.mock.calls[0][1] as {
      inbound_agents: unknown;
      outbound_agents: unknown;
    };
    expect(body.inbound_agents).toEqual([{ agent_id: "ag_1", weight: 1 }]);
    expect(body.outbound_agents).toEqual([{ agent_id: "ag_1", weight: 1 }]);
  });
});
