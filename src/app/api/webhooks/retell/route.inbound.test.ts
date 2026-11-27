import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Retell's inbound webhook ("call_inbound"): sent while the phone rings. A
 * reject hangs up before any agent starts; everything else — including any
 * error or a slow answer — lets the call through to the AI.
 */

vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
let signatureOk = true;
vi.mock("@/lib/retell", () => ({ verifyRetellSignature: () => signatureOk }));
const recordWebhookEvent = vi.fn(async () => ({ isNew: true }));
vi.mock("@/lib/data/webhook-events", () => ({
  recordWebhookEvent,
  markWebhookProcessed: async () => {},
  deleteWebhookEvent: async () => {},
}));
vi.mock("@/lib/data/clients", () => ({ getClientByRetellAgentId: async () => null }));
vi.mock("@/lib/data/calls", () => ({ upsertCallByRetellId: async () => null }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/agents/extract", () => ({ extractCallInsights: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notifyOwnerCallProblem: vi.fn() }));
vi.mock("@/lib/call-recap-send", () => ({ sendCallRecap: vi.fn() }));
vi.mock("@/lib/hours-util", () => ({ isAfterHours: () => false }));
vi.mock("@/lib/webhooks-emit", () => ({ emitWebhook: vi.fn() }));
const screenInboundCall = vi.fn();
vi.mock("@/lib/data/inbound-screen", () => ({ screenInboundCall: (i: unknown) => screenInboundCall(i) }));

const { POST, INBOUND_SCREEN_TIMEOUT_MS } = await import("./route");

const inbound = () =>
  new Request("https://app.test/api/webhooks/retell", {
    method: "POST",
    body: JSON.stringify({
      event: "call_inbound",
      call_inbound: { call_id: "call_1", agent_id: "agent_1", from_number: "+14155550134", to_number: "+14155550000" },
    }),
  });

beforeEach(() => {
  signatureOk = true;
  screenInboundCall.mockReset();
  recordWebhookEvent.mockClear();
});

describe("call_inbound", () => {
  it("rejects with only { reject: true } when the screen says so", async () => {
    screenInboundCall.mockResolvedValue({ clientId: "c1", screen: { reject: true, reason: "blocked" } });
    const res = await POST(inbound());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ call_inbound: { reject: true } });
    expect(screenInboundCall).toHaveBeenCalledWith({
      agentId: "agent_1",
      toNumber: "+14155550000",
      fromNumber: "+14155550134",
    });
  });

  it("lets everyone else through with an empty answer (the number's own agent picks up)", async () => {
    screenInboundCall.mockResolvedValue({ clientId: "c1", screen: { reject: false, reason: null } });
    expect(await (await POST(inbound())).json()).toEqual({ call_inbound: {} });
  });

  it("fails open: a database error lets the call through", async () => {
    screenInboundCall.mockRejectedValue(new Error("db down"));
    const res = await POST(inbound());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ call_inbound: {} });
  });

  it("fails open: a slow screen lets the call through well inside Retell's 10s", async () => {
    vi.useFakeTimers();
    try {
      screenInboundCall.mockReturnValue(new Promise(() => {}));
      const pending = POST(inbound());
      await vi.advanceTimersByTimeAsync(INBOUND_SCREEN_TIMEOUT_MS);
      expect(await (await pending).json()).toEqual({ call_inbound: {} });
      expect(INBOUND_SCREEN_TIMEOUT_MS).toBeLessThan(10_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("is not written to the webhook ledger (no call exists yet; retries recompute the same answer)", async () => {
    screenInboundCall.mockResolvedValue({ clientId: "c1", screen: { reject: true, reason: "repeat_spam" } });
    await POST(inbound());
    await POST(inbound());
    expect(recordWebhookEvent).not.toHaveBeenCalled();
    expect(screenInboundCall).toHaveBeenCalledTimes(2);
  });

  it("an unsigned request is refused, so it can never reject a call", async () => {
    signatureOk = false;
    expect((await POST(inbound())).status).toBe(401);
    expect(screenInboundCall).not.toHaveBeenCalled();
  });
});
