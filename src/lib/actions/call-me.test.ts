import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  createPhoneCall: vi.fn(async (..._a: unknown[]): Promise<{ call_id: string }> => ({ call_id: "call_1" })),
  client: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/data/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/auth-guard", () => ({
  requireClientEditor: async () => ({ ok: true, user: { id: "u1", orgId: "o1" } }),
}));
vi.mock("@/lib/data/clients", () => ({
  assertClientInOrg: async () => {},
  getClientByIdUnsafe: async () => m.client,
}));
vi.mock("@/lib/retell", () => ({ getRetellClient: () => ({ call: { createPhoneCall: m.createPhoneCall } }) }));
vi.mock("@/lib/env", () => ({ integrations: { retell: () => true } }));
vi.mock("@/lib/rate-limit", () => ({
  consumeAttempt: () => ({ ok: true }),
  formatRetryAfter: () => "a bit",
}));
vi.mock("@/lib/waf-rate-limit", () => ({
  WAF_RATE_LIMIT_IDS: { callMe: "owner-call-me" },
  wafRateLimited: async () => false,
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { callMeNowAction } from "./call-me";

const form = (phone = "(415) 747-5690") => {
  const f = new FormData();
  f.set("clientId", "8d787138-bf6e-47a6-9e49-36ea6596cd7d");
  f.set("phone", phone);
  return f;
};

beforeEach(() => {
  m.createPhoneCall.mockClear();
  m.client = {
    id: "8d787138-bf6e-47a6-9e49-36ea6596cd7d",
    name: "Lawyers for justice",
    agentName: "Riley",
    retellAgentId: "agent_247832e0068ae1b08fe5812956",
    retellPhoneNumber: "+12272382281",
  };
});

describe("callMeNowAction", () => {
  it("passes the business's agent per call: a number bound as inbound-only has no outbound agent", async () => {
    const r = await callMeNowAction({ ok: false }, form());
    expect(r.ok).toBe(true);
    const arg = m.createPhoneCall.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.from_number).toBe("+12272382281");
    expect(arg.to_number).toBe("+14157475690");
    expect(arg.override_agent_id).toBe("agent_247832e0068ae1b08fe5812956");
  });

  it("shows the real cause, not 'may not be able to dial out'", async () => {
    m.createPhoneCall.mockRejectedValueOnce(new Error("402 Payment required"));
    const r = await callMeNowAction({ ok: false }, form());
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/billing/);
    expect(r.error).not.toMatch(/may not be able to dial out/);
  });

  it("rejects a bad number before calling", async () => {
    const r = await callMeNowAction({ ok: false }, form("123"));
    expect(r.ok).toBe(false);
    expect(m.createPhoneCall).not.toHaveBeenCalled();
  });
});
