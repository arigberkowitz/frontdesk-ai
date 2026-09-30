import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "test-agent-tools-secret";
const RETELL_KEY = "key_test_retell";
const CLIENT_A = "11111111-1111-4111-8111-111111111111";
const CLIENT_B = "22222222-2222-4222-8222-222222222222";

const mockEnv = {
  AGENT_TOOLS_SECRET: SECRET,
  RETELL_API_KEY: RETELL_KEY,
  AGENT_TOOLS_SIGNATURE_MODE: "enforce" as "enforce" | "report",
};
vi.mock("@/lib/env", () => ({ env: mockEnv, integrations: { retell: () => true } }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/data/clients", () => ({
  getClientByIdUnsafe: async (id: string) =>
    [CLIENT_A, CLIENT_B].includes(id)
      ? { id, retellAgentId: id === CLIENT_A ? "agent_a" : "agent_b", services: [], businessHours: [] }
      : undefined,
}));

const { authorizeAgentTool } = await import("./agent-tools-auth");
const { agentToolToken, signChatToolRequest, verifyChatToolSignature, CHAT_SIGNATURE_HEADER } =
  await import("./agent-tool-token");

function retellSig(body: string, ts = Date.now()): string {
  const d = createHmac("sha256", RETELL_KEY).update(body + ts).digest("hex");
  return `v=${ts},d=${d}`;
}

function toolReq(opts: {
  client: string;
  token: string;
  body: unknown;
  headers?: Record<string, string>;
}): Request {
  const url = `https://app.test/api/agent-tools/cancel?client=${opts.client}&token=${encodeURIComponent(opts.token)}`;
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(opts.headers ?? {}) },
    body: typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body),
  });
}

describe("agent tool tokens", () => {
  it("are per client and stable", () => {
    expect(agentToolToken(CLIENT_A)).toBe(agentToolToken(CLIENT_A));
    expect(agentToolToken(CLIENT_A)).not.toBe(agentToolToken(CLIENT_B));
    expect(agentToolToken(CLIENT_A)).not.toContain(SECRET);
  });

  it("chat signatures bind client, body and time", () => {
    const now = Date.now();
    const sig = signChatToolRequest(CLIENT_A, "{}", now);
    expect(verifyChatToolSignature(CLIENT_A, "{}", sig, now)).toBe(true);
    expect(verifyChatToolSignature(CLIENT_B, "{}", sig, now)).toBe(false);
    expect(verifyChatToolSignature(CLIENT_A, '{"x":1}', sig, now)).toBe(false);
    expect(verifyChatToolSignature(CLIENT_A, "{}", sig, now + 10 * 60_000)).toBe(false);
  });
});

describe("authorizeAgentTool", () => {
  beforeEach(() => {
    mockEnv.AGENT_TOOLS_SIGNATURE_MODE = "enforce";
  });

  it("accepts a Retell-signed call with the client's own token as voice", async () => {
    const body = JSON.stringify({ args: { phone: "555" }, call: { call_id: "c1", agent_id: "agent_a" } });
    const res = await authorizeAgentTool(
      toolReq({ client: CLIENT_A, token: agentToolToken(CLIENT_A), body, headers: { "x-retell-signature": retellSig(body) } }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.channel).toBe("voice");
      expect(res.client.id).toBe(CLIENT_A);
      expect(res.args).toEqual({ phone: "555" });
      expect(res.retellCallId).toBe("c1");
    }
  });

  it("rejects another client's token (no cross-tenant use)", async () => {
    const body = JSON.stringify({ args: {} });
    const res = await authorizeAgentTool(
      toolReq({ client: CLIENT_B, token: agentToolToken(CLIENT_A), body, headers: { "x-retell-signature": retellSig(body) } }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(401);
  });

  it("rejects an unsigned call even with a valid token", async () => {
    const res = await authorizeAgentTool(toolReq({ client: CLIENT_A, token: agentToolToken(CLIENT_A), body: { args: {} } }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(401);
  });

  it("rejects a tampered body", async () => {
    const body = JSON.stringify({ args: { phone: "555" } });
    const res = await authorizeAgentTool(
      toolReq({
        client: CLIENT_A,
        token: agentToolToken(CLIENT_A),
        body: JSON.stringify({ args: { phone: "666" } }),
        headers: { "x-retell-signature": retellSig(body) },
      }),
    );
    expect(res.ok).toBe(false);
  });

  it("report mode lets an unsigned call through (rollout escape hatch)", async () => {
    mockEnv.AGENT_TOOLS_SIGNATURE_MODE = "report";
    const res = await authorizeAgentTool(toolReq({ client: CLIENT_A, token: agentToolToken(CLIENT_A), body: { args: {} } }));
    expect(res.ok).toBe(true);
  });

  it("identifies web chat only from a valid chat signature", async () => {
    const body = JSON.stringify({ args: { phone: "555" }, call: { channel: "web_chat" } });
    const ok = await authorizeAgentTool(
      toolReq({
        client: CLIENT_A,
        token: agentToolToken(CLIENT_A),
        body,
        headers: { [CHAT_SIGNATURE_HEADER]: signChatToolRequest(CLIENT_A, body) },
      }),
    );
    expect(ok.ok && ok.channel).toBe("web_chat");

    const forged = await authorizeAgentTool(
      toolReq({
        client: CLIENT_A,
        token: agentToolToken(CLIENT_A),
        body,
        headers: { [CHAT_SIGNATURE_HEADER]: signChatToolRequest(CLIENT_B, body) },
      }),
    );
    expect(forged.ok).toBe(false);
  });

  it("accepts the legacy shared token only on a signed call from the client's own agent", async () => {
    const own = JSON.stringify({ args: {}, call: { agent_id: "agent_a" } });
    const ok = await authorizeAgentTool(
      toolReq({ client: CLIENT_A, token: SECRET, body: own, headers: { "x-retell-signature": retellSig(own) } }),
    );
    expect(ok.ok).toBe(true);

    const other = JSON.stringify({ args: {}, call: { agent_id: "agent_a" } });
    const crossTenant = await authorizeAgentTool(
      toolReq({ client: CLIENT_B, token: SECRET, body: other, headers: { "x-retell-signature": retellSig(other) } }),
    );
    expect(crossTenant.ok).toBe(false);

    const unsigned = await authorizeAgentTool(toolReq({ client: CLIENT_A, token: SECRET, body: own }));
    expect(unsigned.ok).toBe(false);
  });

  it("rejects empty tokens and malformed client ids", async () => {
    expect((await authorizeAgentTool(toolReq({ client: CLIENT_A, token: "", body: {} }))).ok).toBe(false);
    expect((await authorizeAgentTool(toolReq({ client: "x", token: "t", body: {} }))).ok).toBe(false);
  });
});
