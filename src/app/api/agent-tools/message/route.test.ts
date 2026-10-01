import { beforeEach, describe, expect, it, vi } from "vitest";

/** The mid-call "New message" alert is deferred to the call recap on phone calls. */

vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/webhooks-emit", () => ({ emitWebhook: vi.fn() }));
const auth = { channel: "voice", retellCallId: "rc_1" as string | null };
vi.mock("@/lib/agent-tools-auth", () => ({
  authorizeAgentTool: async () => ({
    ok: true,
    client: { id: "client-1" },
    channel: auth.channel,
    args: { name: "Pat", phone: "4155550100", reason: "Crown" },
    retellCallId: auth.retellCallId,
  }),
}));
const callRow = { value: { id: "call-db-1", direction: "inbound" } as { id: string; direction: string } | null };
vi.mock("@/lib/data/calls", () => ({ getCallByRetellId: async () => callRow.value }));
const createLead = vi.fn(async (_c: string, l: Record<string, unknown>) => ({ id: "lead-1", createdAt: new Date(), ...l }));
vi.mock("@/lib/data/leads", () => ({ createLead }));
const notifyOwnerLead = vi.fn(async () => {});
vi.mock("@/lib/notify", () => ({ notifyOwnerLead }));

const { POST } = await import("./route");
const post = () => POST(new Request("https://app.test/api/agent-tools/message", { method: "POST", body: "{}" }));

beforeEach(() => {
  auth.channel = "voice";
  auth.retellCallId = "rc_1";
  callRow.value = { id: "call-db-1", direction: "inbound" };
  notifyOwnerLead.mockClear();
  createLead.mockClear();
});

describe("message tool alert", () => {
  it("an inbound phone call saves the lead on the call and leaves the alert to the recap", async () => {
    const res = await post();
    expect((await res.json()).success).toBe(true);
    expect(createLead.mock.calls[0][1]).toMatchObject({ callId: "call-db-1", phone: "+14155550100" });
    expect(notifyOwnerLead).not.toHaveBeenCalled();
  });

  it("web chat alerts right away", async () => {
    auth.channel = "web_chat";
    auth.retellCallId = null;
    callRow.value = null;
    await post();
    expect(notifyOwnerLead).toHaveBeenCalledTimes(1);
  });

  it("a phone call with no call row yet alerts right away (no recap would know about it)", async () => {
    callRow.value = null;
    await post();
    expect(notifyOwnerLead).toHaveBeenCalledTimes(1);
  });
});
