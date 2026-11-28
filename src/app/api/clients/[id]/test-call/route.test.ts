import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Prod, 27 Nov 2026 4:55 PM PT: starting a browser test call failed with
 * "400 Deprecated API usage is no longer supported: Create Web Call v2."
 * The route must use the v3 helper and forward connection details. A trial's
 * first successful test call is also what unlocks its phone number.
 */

const m = vi.hoisted(() => ({
  user: { id: "u1", orgId: "o1", role: "client_admin" } as Record<string, unknown> | null,
  client: {
    id: "8d787138-bf6e-47a6-9e49-36ea6596cd7d",
    retellAgentId: "ag_1",
  } as Record<string, unknown> | null,
  createWebCall: vi.fn(async () => ({
    callId: "call_test_1",
    accessToken: "tok_test",
    transport: "gateway" as const,
    iceServers: [{ urls: "stun:stun.example.test" }],
  })),
  wafRateLimited: vi.fn(async () => false),
}));

vi.mock("@/lib/auth-guard", () => ({
  getCurrentDbUserSafe: async () => m.user,
  userMayAccessClient: (user: { id?: string } | null, _id: string) => Boolean(user),
}));
vi.mock("@/lib/data/clients", () => ({
  getClient: async () => m.client,
}));
vi.mock("@/lib/retell", () => ({
  createWebCall: m.createWebCall,
}));
vi.mock("@/lib/waf-rate-limit", () => ({
  WAF_RATE_LIMIT_IDS: { testCall: "owner-test-call" },
  wafRateLimited: m.wafRateLimited,
}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const { POST } = await import("./route");

const CLIENT_ID = "8d787138-bf6e-47a6-9e49-36ea6596cd7d";

function post() {
  return POST(new Request(`https://app.test/api/clients/${CLIENT_ID}/test-call`, { method: "POST" }), {
    params: Promise.resolve({ id: CLIENT_ID }),
  });
}

beforeEach(() => {
  m.user = { id: "u1", orgId: "o1", role: "client_admin" };
  m.client = { id: CLIENT_ID, retellAgentId: "ag_1" };
  m.createWebCall.mockClear();
  m.wafRateLimited.mockReset();
  m.wafRateLimited.mockResolvedValue(false);
});

describe("POST /api/clients/[id]/test-call", () => {
  it("returns v3 connection details from createWebCall", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(m.createWebCall).toHaveBeenCalledWith("ag_1");
    expect(await res.json()).toEqual({
      accessToken: "tok_test",
      callId: "call_test_1",
      transport: "gateway",
      iceServers: [{ urls: "stun:stun.example.test" }],
    });
  });

  it("keeps the friendly error when Retell rejects the call, and does not invent a number", async () => {
    m.createWebCall.mockRejectedValueOnce(
      new Error("400 Deprecated API usage is no longer supported: Create Web Call v2."),
    );
    const res = await post();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "Couldn't start the test call just now. Try again in a moment.",
    });
  });

  it("refuses to start when the receptionist has no agent yet", async () => {
    m.client = { id: CLIENT_ID, retellAgentId: null };
    const res = await post();
    expect(res.status).toBe(400);
    expect(m.createWebCall).not.toHaveBeenCalled();
  });
});
