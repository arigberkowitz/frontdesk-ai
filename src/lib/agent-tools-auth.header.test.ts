import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

/** The token moved from `?token=` to a header; the query path is a short, flagged migration window. */
const SECRET = "test-agent-tools-secret";
const RETELL_KEY = "key_test_retell";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const mockEnv = { AGENT_TOOLS_SECRET: SECRET, RETELL_API_KEY: RETELL_KEY, AGENT_TOOLS_SIGNATURE_MODE: "enforce", AGENT_TOOLS_LEGACY_UNTIL: "off" };
vi.mock("@/lib/env", () => ({ env: mockEnv, integrations: { retell: () => true } }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/data/clients", () => ({
  getClientByIdUnsafe: async (id: string) => ({ id, retellAgentId: id === A ? "agent_a" : "agent_b", services: [], businessHours: [] }),
}));

const { authorizeAgentTool, legacyCredentialsAllowed, DEFAULT_LEGACY_UNTIL } = await import("./agent-tools-auth");
const { agentToolToken, agentToolHeaders, AGENT_TOOL_TOKEN_HEADER } = await import("./agent-tool-token");
const { agentToolUrl } = await import("./retell");

const body = JSON.stringify({ args: {}, call: { agent_id: "agent_a" } });
const sig = (b: string, ts = Date.now()) => `v=${ts},d=${createHmac("sha256", RETELL_KEY).update(b + ts).digest("hex")}`;
const req = (client: string, opts: { header?: string; query?: string }) =>
  new Request(`https://app.test/api/agent-tools/book?client=${client}${opts.query ? `&token=${encodeURIComponent(opts.query)}` : ""}`, {
    method: "POST",
    headers: { "x-retell-signature": sig(body), ...(opts.header ? { [AGENT_TOOL_TOKEN_HEADER]: opts.header } : {}) },
    body,
  });

describe("header tool token", () => {
  it("tool URLs carry no token; headers carry the per-client one", () => {
    const url = agentToolUrl("https://x.test/", "book", A);
    expect(url).toBe(`https://x.test/api/agent-tools/book?client=${A}`);
    expect(agentToolHeaders(A)).toEqual({ [AGENT_TOOL_TOKEN_HEADER]: agentToolToken(A) });
  });
  it("accepts the client's own token in the header", async () => {
    expect((await authorizeAgentTool(req(A, { header: agentToolToken(A) }))).ok).toBe(true);
  });
  it("rejects another client's token", async () => {
    expect((await authorizeAgentTool(req(A, { header: agentToolToken(B) }))).ok).toBe(false);
  });
  it("rejects the raw shared secret in the header once the window is off", async () => {
    expect((await authorizeAgentTool(req(A, { header: SECRET }))).ok).toBe(false);
  });
  it("rejects a query token once the window is off", async () => {
    expect((await authorizeAgentTool(req(A, { query: agentToolToken(A) }))).ok).toBe(false);
  });
  it("accepts a query token during the window, and the shared secret only bound to the client's own agent", async () => {
    mockEnv.AGENT_TOOLS_LEGACY_UNTIL = "2999-01-01T00:00:00Z";
    expect((await authorizeAgentTool(req(A, { query: agentToolToken(A) }))).ok).toBe(true);
    expect((await authorizeAgentTool(req(A, { query: SECRET }))).ok).toBe(true);
    expect((await authorizeAgentTool(req(B, { query: SECRET }))).ok).toBe(false); // agent_a call aimed at B
    mockEnv.AGENT_TOOLS_LEGACY_UNTIL = "off";
  });
  it("window logic", () => {
    const t = Date.parse("2026-10-20T00:00:00Z");
    expect(legacyCredentialsAllowed(t, "")).toBe(true);
    expect(legacyCredentialsAllowed(Date.parse(DEFAULT_LEGACY_UNTIL), "")).toBe(false);
    expect(legacyCredentialsAllowed(t, "off")).toBe(false);
    expect(legacyCredentialsAllowed(t, "2026-10-15")).toBe(false);
    expect(legacyCredentialsAllowed(t, "garbage")).toBe(false);
  });
});
