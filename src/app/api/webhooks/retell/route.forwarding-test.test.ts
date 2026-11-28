import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Test my forwarding": our own test call arriving at the AI number must be
 * turned away before any agent starts and must leave no trace: no call row
 * (so no lead, follow-up, text, usage or billing), no recap, no extraction.
 */

const afterTasks: (() => unknown)[] = [];
vi.mock("next/server", () => ({ after: (fn: () => unknown) => afterTasks.push(fn) }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/retell", () => ({ verifyRetellSignature: () => true }));
vi.mock("@/lib/data/webhook-events", () => ({
  recordWebhookEvent: async () => ({ isNew: true }),
  markWebhookProcessed: async () => {},
  deleteWebhookEvent: async () => {},
}));
const FLAGS = {
  forwardingTest: {
    id: "t1",
    status: "pending",
    startedAt: new Date().toISOString(),
    mode: "all_calls",
    callerNumber: "+18885550001",
    dialed: "+14155550100",
  },
};
const CLIENT = {
  id: "client-1",
  name: "Biz",
  timezone: "America/New_York",
  businessHours: null,
  retellPhoneNumber: "+12272382281",
  forwardingNumber: "+14155550100",
  answeringMode: "all_calls",
  setupFlags: FLAGS,
};
vi.mock("@/lib/data/clients", () => ({ getClientByRetellAgentId: async () => CLIENT }));
const upsertCallByRetellId = vi.fn(async (..._a: unknown[]) => ({ id: "call-db-1" }));
vi.mock("@/lib/data/calls", () => ({ upsertCallByRetellId: (...a: unknown[]) => upsertCallByRetellId(...a) }));
vi.mock("@/db", () => ({ db: { query: { appointments: { findFirst: async () => null }, leads: { findFirst: async () => null } } } }));
const extractCallInsights = vi.fn(async () => {});
vi.mock("@/lib/agents/extract", () => ({ extractCallInsights }));
const notifyOwnerCallProblem = vi.fn(async () => {});
vi.mock("@/lib/notify", () => ({ notifyOwnerCallProblem }));
const sendCallRecap = vi.fn(async () => ({ status: "sent" }));
vi.mock("@/lib/call-recap-send", () => ({ sendCallRecap }));
vi.mock("@/lib/hours-util", () => ({ isAfterHours: () => false }));
const emitWebhook = vi.fn(async () => {});
vi.mock("@/lib/webhooks-emit", () => ({ emitWebhook }));
vi.mock("@/lib/provision", () => ({ provisionNumberIfUnlocked: vi.fn() }));
const screenInboundCall = vi.fn(async (_i: unknown) => ({ clientId: "client-1", screen: { reject: false, reason: null } }));
vi.mock("@/lib/data/inbound-screen", () => ({ screenInboundCall: (i: unknown) => screenInboundCall(i), recordTurnedAway: vi.fn() }));

const markPassed = vi.fn(async (..._a: unknown[]) => true);
const logResult = vi.fn(async (..._a: unknown[]) => {});
vi.mock("@/lib/data/forwarding-test", () => ({
  forwardingTestStore: { markPassed: (...a: unknown[]) => markPassed(...a), logResult: (...a: unknown[]) => logResult(...a) },
  claimInboundForwardingTest: async (info: { fromNumber?: string }) => info.fromNumber === "+18885550001",
}));

const { POST } = await import("./route");

const post = (body: unknown) => POST(new Request("https://app.test/api/webhooks/retell", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  afterTasks.length = 0;
  vi.clearAllMocks();
  CLIENT.setupFlags = { ...FLAGS, forwardingTest: { ...FLAGS.forwardingTest, status: "pending", startedAt: new Date().toISOString() } };
});

describe("forwarding test arrival", () => {
  it("call_inbound from our test number is rejected before any agent starts, and skips the spam screen", async () => {
    const res = await post({
      event: "call_inbound",
      call_inbound: { call_id: "c", agent_id: "ag_1", from_number: "+18885550001", to_number: "+12272382281" },
    });
    expect(await res.json()).toEqual({ call_inbound: { reject: true } });
    expect(screenInboundCall).not.toHaveBeenCalled();
    expect(upsertCallByRetellId).not.toHaveBeenCalled();
  });

  it("a real customer call is screened and answered exactly as before", async () => {
    const res = await post({
      event: "call_inbound",
      call_inbound: { call_id: "c", agent_id: "ag_1", from_number: "+13105550123", to_number: "+12272382281" },
    });
    expect(await res.json()).toEqual({ call_inbound: {} });
    expect(screenInboundCall).toHaveBeenCalledTimes(1);
  });

  it.each(["call_started", "call_ended", "call_analyzed"])(
    "%s from our test number records the pass but creates no call row, recap, extraction, alert or outbound webhook",
    async (event) => {
      const res = await post({
        event,
        call: { call_id: "rc_t", agent_id: "ag_1", from_number: "+18885550001", to_number: "+12272382281", transcript: "Hello?", duration_ms: 4000 },
      });
      expect(await res.json()).toEqual({ ok: true, ignored: "forwarding test" });
      for (const t of afterTasks.splice(0)) await t();
      expect(upsertCallByRetellId).not.toHaveBeenCalled();
      expect(sendCallRecap).not.toHaveBeenCalled();
      expect(extractCallInsights).not.toHaveBeenCalled();
      expect(notifyOwnerCallProblem).not.toHaveBeenCalled();
      expect(emitWebhook).not.toHaveBeenCalled();
      expect(markPassed).toHaveBeenCalledTimes(1);
    },
  );

  it("a normal call event from a customer still creates its call row", async () => {
    await post({ event: "call_started", call: { call_id: "rc_n", agent_id: "ag_1", from_number: "+13105550123" } });
    expect(upsertCallByRetellId).toHaveBeenCalled();
    expect(markPassed).not.toHaveBeenCalled();
  });
});
