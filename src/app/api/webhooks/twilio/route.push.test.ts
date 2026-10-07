import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Twilio webhook × phone notifications: a new customer text queues a push
 * (after the response) that says who texted and never what; STOP and replays
 * never push; with push unconfigured nothing is queued.
 */

const TOKEN = "twilio-token";
const URL_ = "https://app.test/api/webhooks/twilio";
const OWNER = { id: "11111111-1111-4111-8111-111111111111", name: "Acme", aiTextRepliesEnabled: false };

let plan: { ok: boolean; reason?: string } | Error = { ok: true };
const afterFns: (() => unknown)[] = [];
const runAiTextReply = vi.fn(async (..._a: unknown[]) => ({ status: "replied" }));
const notifyOwnerTextReply = vi.fn(async (..._a: unknown[]) => ({ status: "sent" }));
const recordOptOut = vi.fn(async (..._a: unknown[]) => {});
const pushToClient = vi.fn(async (..._a: unknown[]) => ({ sent: 1, removed: 0, failed: 0 }));
let configured = true;
let isNew = true;

vi.mock("next/server", () => ({ after: (fn: () => unknown) => afterFns.push(fn) }));
vi.mock("@/lib/env", () => ({
  env: { TWILIO_AUTH_TOKEN: TOKEN },
  integrations: { anthropic: () => true },
  webhookUrl: (p: string) => `https://app.test${p}`,
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/db", () => ({ db: { query: { leads: { findFirst: async () => null } } } }));
vi.mock("@/lib/data/sms-optouts", () => ({
  recordOptOut: (...a: unknown[]) => recordOptOut(...a),
  removeOptOut: vi.fn(),
  normalizePhone: (r: string) => r.replace(/\D/g, ""),
}));
vi.mock("@/lib/sms-inbox", () => ({ storeInboundMessage: async () => ({ owner: OWNER, isNew }) }));
vi.mock("@/lib/push", () => ({
  pushConfigured: () => configured,
  pushToClient: (...a: unknown[]) => pushToClient(...a),
}));
vi.mock("@/lib/data/sms-numbers", () => ({ findClientBySmsNumber: async () => null }));
vi.mock("@/lib/data/sms-messages", () => ({ updateSmsDeliveryStatus: vi.fn() }));
vi.mock("@/lib/notifier", () => ({ explainSmsError: () => "" }));
vi.mock("@/lib/data/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/reply-alerts", () => ({ notifyOwnerTextReply: (...a: unknown[]) => notifyOwnerTextReply(...a) }));
vi.mock("@/lib/agents/text-reply", () => ({
  planAiReply: async () => {
    if (plan instanceof Error) throw plan;
    return plan;
  },
  runAiTextReply: (...a: unknown[]) => runAiTextReply(...a),
}));

const { POST } = await import("./route");

function signed(params: Record<string, string>): Request {
  const data = URL_ + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const sig = createHmac("sha1", TOKEN).update(data).digest("base64");
  return new Request(URL_, {
    method: "POST",
    headers: { "x-twilio-signature": sig, host: "app.test" },
    body: new URLSearchParams(params),
  });
}
const text = (Body: string) => signed({ From: "+14155550100", To: "+18885550000", Body, MessageSid: "SM" + Math.random() });

beforeEach(() => {
  OWNER.aiTextRepliesEnabled = false;
  plan = { ok: true };
  configured = true;
  isNew = true;
  afterFns.length = 0;
  for (const f of [runAiTextReply, notifyOwnerTextReply, recordOptOut, pushToClient]) f.mockClear();
});

describe("twilio webhook × phone notifications", () => {
  it("a new customer text pushes after the response: who, never what", async () => {
    await POST(text("My tooth really hurts, is Dr. Lee in?"));
    expect(pushToClient).not.toHaveBeenCalled(); // not inside the request
    expect(afterFns).toHaveLength(1);
    await afterFns[0]();
    expect(pushToClient).toHaveBeenCalledTimes(1);
    const [clientId, kind, payload] = pushToClient.mock.calls[0] as [string, string, Record<string, string>];
    expect(clientId).toBe(OWNER.id);
    expect(kind).toBe("text");
    expect(payload.title).toBe("New text from (415) 555-0100");
    expect(payload.url).toBe("/portal/messages/14155550100");
    expect(JSON.stringify(payload)).not.toMatch(/tooth|Dr\. Lee/);
    // The email/SMS alert still goes out as before.
    expect(notifyOwnerTextReply).toHaveBeenCalledTimes(1);
  });

  it("when the AI is answering, the push says so (and the AI still runs)", async () => {
    OWNER.aiTextRepliesEnabled = true;
    await POST(text("Can I book Tuesday?"));
    expect(afterFns).toHaveLength(2);
    for (const fn of afterFns) await fn();
    const payload = pushToClient.mock.calls[0][2] as { body: string };
    expect(payload.body).toMatch(/AI is answering/);
    expect(runAiTextReply).toHaveBeenCalledTimes(1);
  });

  it("push not configured: nothing queued", async () => {
    configured = false;
    await POST(text("hello"));
    expect(afterFns).toHaveLength(0);
    expect(pushToClient).not.toHaveBeenCalled();
  });

  it("a Twilio replay doesn't push twice", async () => {
    isNew = false;
    await POST(text("hello"));
    expect(afterFns).toHaveLength(0);
  });

  it("STOP never pushes", async () => {
    await POST(text("STOP"));
    expect(recordOptOut).toHaveBeenCalled();
    expect(afterFns).toHaveLength(0);
  });
});
