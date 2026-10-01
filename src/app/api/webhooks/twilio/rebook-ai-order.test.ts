import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Smart rebooking × AI text replies: when a business has both on, a reply to
 * an open rebooking offer goes to the rebooking handler FIRST and the AI never
 * sees it. With no open offer, the AI takes the text as usual.
 */

const TOKEN = "test-auth-token";
const URL_ = "https://frontdeskai.company/api/webhooks/twilio";

const owner = { id: "c1", ownerEmail: "o@biz.test", smartRebookingEnabled: true, aiTextRepliesEnabled: true };
const notifyOwnerTextReply = vi.fn(async (..._a: unknown[]) => ({ status: "sent" as const, sent: 1, failed: 0 }));
const findOpenOffer = vi.fn(async (..._a: unknown[]) => ({ id: "o1" }) as { id: string } | null);
const handleRebookReply = vi.fn(async (..._a: unknown[]) => ({ handled: true, result: "rescheduled", alertOwner: false }));
const planAiReply = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
const runAiTextReply = vi.fn(async (..._a: unknown[]) => ({ status: "replied" }));
const pending: Promise<unknown>[] = [];

vi.mock("next/server", () => ({ after: (fn: () => Promise<unknown>) => pending.push(fn()) }));
vi.mock("@/lib/env", () => ({
  env: { TWILIO_AUTH_TOKEN: "test-auth-token" },
  integrations: { anthropic: () => true },
  webhookUrl: (p: string) => `https://frontdeskai.company${p}`,
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/data/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/data/sms-optouts", () => ({
  recordOptOut: vi.fn(),
  removeOptOut: vi.fn(),
  normalizePhone: (raw: string) => raw.replace(/[^\d]/g, ""),
}));
vi.mock("@/lib/sms-inbox", () => ({ storeInboundMessage: async () => ({ owner, isNew: true }) }));
vi.mock("@/lib/data/sms-numbers", () => ({ findClientBySmsNumber: async () => null }));
vi.mock("@/lib/data/sms-messages", () => ({ updateSmsDeliveryStatus: vi.fn() }));
vi.mock("@/lib/reply-alerts", () => ({ notifyOwnerTextReply }));
vi.mock("@/lib/notifier", () => ({ explainSmsError: (_c: unknown, f: string) => f }));
vi.mock("@/lib/rebooking", () => ({ findOpenOffer, handleRebookReply }));
vi.mock("@/lib/agents/text-reply", () => ({ planAiReply, runAiTextReply }));
vi.mock("@/db", () => ({
  db: {
    query: { leads: { findFirst: async () => undefined } },
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  },
}));

const { POST } = await import("./route");

function req(Body: string): Request {
  const params = { From: "+14155550100", To: "+18885550000", Body, MessageSid: `SM_${Body}_${Math.random()}` };
  const data = URL_ + Object.keys(params).sort().map((k) => k + params[k as keyof typeof params]).join("");
  return new Request(URL_, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": createHmac("sha1", TOKEN).update(data).digest("base64"),
      host: "frontdeskai.company",
    },
    body: new URLSearchParams(params).toString(),
  });
}

beforeEach(() => {
  pending.length = 0;
  notifyOwnerTextReply.mockClear();
  findOpenOffer.mockClear().mockResolvedValue({ id: "o1" });
  handleRebookReply.mockClear();
  planAiReply.mockClear();
  runAiTextReply.mockClear();
});

describe("Twilio webhook: rebook-offer replies run before AI text replies", () => {
  it("an open offer's reply goes to the rebooking handler and the AI never runs", async () => {
    await POST(req("2"));
    await Promise.all(pending);
    expect(handleRebookReply).toHaveBeenCalledWith(owner, { id: "o1" }, "2");
    expect(planAiReply).not.toHaveBeenCalled();
    expect(runAiTextReply).not.toHaveBeenCalled();
    expect(notifyOwnerTextReply).not.toHaveBeenCalled();
  });

  it("with no open offer, the AI takes the text", async () => {
    findOpenOffer.mockResolvedValue(null);
    await POST(req("do you have anything tuesday?"));
    await Promise.all(pending);
    expect(handleRebookReply).not.toHaveBeenCalled();
    expect(planAiReply).toHaveBeenCalled();
    expect(runAiTextReply).toHaveBeenCalledTimes(1);
  });
});
