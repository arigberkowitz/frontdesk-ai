import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Retell webhook → which owner alert a terminal call event produces.
 * One alert per call: a message or a transfer gets the call recap (after
 * extraction); other problem calls keep the call-problem alert.
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
const CLIENT = { id: "client-1", name: "Biz", timezone: "America/New_York", businessHours: null, setupFlags: {} };
vi.mock("@/lib/data/clients", () => ({ getClientByRetellAgentId: async () => CLIENT }));
vi.mock("@/lib/data/calls", () => ({ upsertCallByRetellId: async () => ({ id: "call-db-1" }) }));
const state = { appt: null as object | null, lead: null as object | null };
vi.mock("@/db", () => ({
  db: {
    query: {
      appointments: { findFirst: async () => state.appt },
      leads: { findFirst: async () => state.lead },
    },
  },
}));
const extractCallInsights = vi.fn(async () => {});
vi.mock("@/lib/agents/extract", () => ({ extractCallInsights }));
const notifyOwnerCallProblem = vi.fn(async () => {});
vi.mock("@/lib/notify", () => ({ notifyOwnerCallProblem }));
const order: string[] = [];
const sendCallRecap = vi.fn(async () => {
  order.push("recap");
  return { status: "sent" };
});
vi.mock("@/lib/call-recap-send", () => ({ sendCallRecap }));
vi.mock("@/lib/hours-util", () => ({ isAfterHours: () => false }));
vi.mock("@/lib/webhooks-emit", () => ({ emitWebhook: async () => {} }));

const { POST } = await import("./route");

function req(event: string, call: Record<string, unknown>) {
  return new Request("https://app.test/api/webhooks/retell", {
    method: "POST",
    body: JSON.stringify({ event, call: { call_id: "rc_1", agent_id: "ag_1", from_number: "+14155550100", ...call } }),
  });
}
async function run(event: string, call: Record<string, unknown>) {
  const res = await POST(req(event, call));
  expect(res.status).toBe(200);
  for (const t of afterTasks.splice(0)) await t();
  return res;
}

beforeEach(() => {
  state.appt = null;
  state.lead = null;
  afterTasks.length = 0;
  order.length = 0;
  extractCallInsights.mockClear();
  extractCallInsights.mockImplementation(async () => {
    order.push("extract");
  });
  notifyOwnerCallProblem.mockClear();
  sendCallRecap.mockClear();
});

describe("retell webhook alerts", () => {
  it("a message taken → one recap after extraction, no problem alert even with emergency words", async () => {
    state.lead = { id: "lead-1" };
    const call = { transcript: "Agent: Hi\nUser: There's a flood in my kitchen, it's an emergency", duration_ms: 60000 };
    await run("call_ended", call);
    await run("call_analyzed", call);
    expect(notifyOwnerCallProblem).not.toHaveBeenCalled();
    expect(sendCallRecap).toHaveBeenCalledTimes(1);
    expect(sendCallRecap).toHaveBeenCalledWith(CLIENT, "call-db-1", {
      kind: "message",
      problems: expect.arrayContaining(["possible_emergency"]),
    });
    expect(order).toEqual(["extract", "recap"]);
  });

  it("a message on a call that also booked is still recapped", async () => {
    state.appt = { id: "appt-1" };
    state.lead = { id: "lead-1" };
    await run("call_analyzed", { transcript: "Agent: Hi\nUser: hi" });
    expect(sendCallRecap).toHaveBeenCalledWith(CLIENT, "call-db-1", expect.objectContaining({ kind: "message" }));
  });

  it("a transfer that connected → transfer recap, and the caller is NOT alerted as stranded", async () => {
    const call = { transcript: "User: Can I talk to a real person?\nAgent: Connecting you.", disconnection_reason: "call_transfer", duration_ms: 90000 };
    await run("call_ended", call);
    await run("call_analyzed", call);
    expect(notifyOwnerCallProblem).not.toHaveBeenCalled();
    expect(sendCallRecap).toHaveBeenCalledTimes(1);
    const [, , input] = sendCallRecap.mock.calls[0] as unknown as [unknown, unknown, { kind: string; problems: string[] }];
    expect(input.kind).toBe("transfer");
    expect(input.problems).not.toContain("stranded_asking_for_human");
  });

  it("a transfer that hit voicemail → transfer_failed recap", async () => {
    const call = {
      transcript: "User: Let me talk to a person\nAgent: One moment\nTransfer Target: The person you are trying to reach is not available. Please leave a message after the beep.",
      duration_ms: 70000,
    };
    await run("call_analyzed", call);
    expect(sendCallRecap).toHaveBeenCalledWith(CLIENT, "call-db-1", expect.objectContaining({ kind: "transfer_failed" }));
    expect(notifyOwnerCallProblem).not.toHaveBeenCalled();
  });

  it("asked for a person, no transfer, no message → the existing problem alert, no recap", async () => {
    await run("call_ended", { transcript: "User: I want to talk to a human\nAgent: I can help.", duration_ms: 40000 });
    expect(notifyOwnerCallProblem).toHaveBeenCalledTimes(1);
    expect(sendCallRecap).not.toHaveBeenCalled();
  });

  it("an ordinary answered call → nothing", async () => {
    await run("call_analyzed", { transcript: "User: What are your hours?\nAgent: 9 to 5.", duration_ms: 40000 });
    expect(notifyOwnerCallProblem).not.toHaveBeenCalled();
    expect(sendCallRecap).not.toHaveBeenCalled();
    expect(extractCallInsights).toHaveBeenCalledTimes(1);
  });

  it("outbound calls never recap", async () => {
    state.lead = { id: "lead-1" };
    await run("call_analyzed", { transcript: "Agent: Hi, calling back", metadata: { direction: "outbound" } });
    expect(sendCallRecap).not.toHaveBeenCalled();
  });
});
