import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Twilio webhook × AI text replies: off by default the owner gets the usual
 * reply alert and no AI runs; when on and eligible the AI takes the text (no
 * duplicate email); STOP never reaches the AI; a lookup error falls back to the
 * alert.
 */

const TOKEN = "twilio-token";
const URL_ = "https://app.test/api/webhooks/twilio";
const OWNER = { id: "11111111-1111-4111-8111-111111111111", name: "Acme", aiTextRepliesEnabled: false };

let plan: { ok: boolean; reason?: string } | Error = { ok: true };
const afterFns: (() => unknown)[] = [];
const runAiTextReply = vi.fn(async (..._a: unknown[]) => ({ status: "replied" }));
const notifyOwnerTextReply = vi.fn(async (..._a: unknown[]) => ({ status: "sent" }));
const recordOptOut = vi.fn(async (..._a: unknown[]) => {});

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
vi.mock("@/lib/sms-inbox", () => ({ storeInboundMessage: async () => ({ owner: OWNER, isNew: true }) }));
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
  afterFns.length = 0;
  for (const f of [runAiTextReply, notifyOwnerTextReply, recordOptOut]) f.mockClear();
});

describe("twilio webhook × AI text replies", () => {
  it("off by default: the owner gets the reply alert and no AI runs", async () => {
    await POST(text("Can I book Tuesday?"));
    expect(notifyOwnerTextReply).toHaveBeenCalledTimes(1);
    expect(afterFns).toHaveLength(0);
    expect(runAiTextReply).not.toHaveBeenCalled();
  });

  it("on + eligible: the AI takes it (after the response) and the owner isn't emailed", async () => {
    OWNER.aiTextRepliesEnabled = true;
    await POST(text("Can I book Tuesday?"));
    expect(notifyOwnerTextReply).not.toHaveBeenCalled();
    expect(afterFns).toHaveLength(1);
    await afterFns[0]();
    expect(runAiTextReply).toHaveBeenCalledWith(OWNER, "+14155550100");
  });

  it("on but not eligible (e.g. owner just replied): normal alert, no AI", async () => {
    OWNER.aiTextRepliesEnabled = true;
    plan = { ok: false, reason: "owner_replied" };
    await POST(text("thanks!"));
    expect(notifyOwnerTextReply).toHaveBeenCalledTimes(1);
    expect(afterFns).toHaveLength(0);
  });

  it("a lookup error falls back to the alert", async () => {
    OWNER.aiTextRepliesEnabled = true;
    plan = new Error("db down");
    await POST(text("hello"));
    expect(notifyOwnerTextReply).toHaveBeenCalledTimes(1);
    expect(afterFns).toHaveLength(0);
  });

  it("STOP is recorded and never reaches the AI", async () => {
    OWNER.aiTextRepliesEnabled = true;
    await POST(text("STOP please cancel my 2pm"));
    expect(recordOptOut).toHaveBeenCalled();
    expect(afterFns).toHaveLength(0);
    expect(runAiTextReply).not.toHaveBeenCalled();
  });
});
