import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Twilio webhook's smart-rebooking branch: a reply to an open offer is
 * handled by the rebooking module (not emailed as a plain reply) — but only for
 * businesses with the feature on, and anything it can't handle cleanly still
 * reaches the owner.
 */

const TOKEN = "test-auth-token";
const URL_ = "https://frontdeskai.company/api/webhooks/twilio";

const owner = { id: "c1", ownerEmail: "o@biz.test", smartRebookingEnabled: true };
const storeInboundMessage = vi.fn(async (..._a: unknown[]) => ({ owner: owner as Record<string, unknown>, isNew: true }));
const notifyOwnerTextReply = vi.fn(async (..._a: unknown[]) => ({ status: "sent" as const, sent: 1, failed: 0 }));
const findOpenOffer = vi.fn(async (..._a: unknown[]) => ({ id: "o1" }) as { id: string } | null);
const handleRebookReply = vi.fn(async (..._a: unknown[]) => ({
  handled: true,
  result: "rescheduled",
  alertOwner: false,
}) as { handled: boolean; result: string; alertOwner: boolean });
const pending: Promise<unknown>[] = [];

vi.mock("next/server", () => ({ after: (fn: () => Promise<unknown>) => pending.push(fn()) }));
vi.mock("@/lib/env", () => ({
  env: { TWILIO_AUTH_TOKEN: "test-auth-token" },
  webhookUrl: (p: string) => `https://frontdeskai.company${p}`,
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/data/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/data/sms-optouts", () => ({
  recordOptOut: vi.fn(),
  removeOptOut: vi.fn(),
  normalizePhone: (raw: string) => raw.replace(/[^\d]/g, ""),
}));
vi.mock("@/lib/sms-inbox", () => ({ storeInboundMessage }));
vi.mock("@/lib/data/sms-numbers", () => ({ findClientBySmsNumber: async () => null }));
vi.mock("@/lib/data/sms-messages", () => ({ updateSmsDeliveryStatus: vi.fn() }));
vi.mock("@/lib/reply-alerts", () => ({ notifyOwnerTextReply }));
vi.mock("@/lib/notifier", () => ({ explainSmsError: (_c: unknown, f: string) => f }));
vi.mock("@/lib/rebooking", () => ({ findOpenOffer, handleRebookReply }));
vi.mock("@/db", () => ({
  db: {
    query: { leads: { findFirst: async () => undefined } },
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  },
}));

const { POST } = await import("./route");

function req(Body: string): Request {
  const params = { From: "+14155550100", To: "+18885550000", Body, MessageSid: `SM_${Body}` };
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
  owner.smartRebookingEnabled = true;
  storeInboundMessage.mockClear();
  notifyOwnerTextReply.mockClear();
  findOpenOffer.mockClear().mockResolvedValue({ id: "o1" });
  handleRebookReply.mockClear().mockResolvedValue({ handled: true, result: "rescheduled", alertOwner: false });
});

describe("Twilio webhook: replies to rebooking offers", () => {
  it("hands a reply to an open offer to the rebooking handler, without a plain reply alert", async () => {
    const res = await POST(req("2"));
    await Promise.all(pending);
    expect(res.status).toBe(200);
    expect(storeInboundMessage).toHaveBeenCalled(); // still stored in Messages
    expect(handleRebookReply).toHaveBeenCalledWith(owner, { id: "o1" }, "2");
    expect(notifyOwnerTextReply).not.toHaveBeenCalled();
  });

  it("alerts the owner when the handler can't resolve it", async () => {
    handleRebookReply.mockResolvedValue({ handled: false, result: "unclear", alertOwner: true });
    await POST(req("can we do friday instead?"));
    await Promise.all(pending);
    expect(notifyOwnerTextReply).toHaveBeenCalledTimes(1);
  });

  it("alerts the owner if the handler throws", async () => {
    handleRebookReply.mockRejectedValue(new Error("calendar down"));
    await POST(req("1"));
    await Promise.all(pending);
    expect(notifyOwnerTextReply).toHaveBeenCalledTimes(1);
  });

  it("does nothing special when the business has the feature off (the default)", async () => {
    owner.smartRebookingEnabled = false;
    await POST(req("2"));
    expect(findOpenOffer).not.toHaveBeenCalled();
    expect(handleRebookReply).not.toHaveBeenCalled();
    expect(notifyOwnerTextReply).toHaveBeenCalledTimes(1);
  });

  it("no open offer → the normal reply path", async () => {
    findOpenOffer.mockResolvedValue(null);
    await POST(req("2"));
    expect(handleRebookReply).not.toHaveBeenCalled();
    expect(notifyOwnerTextReply).toHaveBeenCalledTimes(1);
  });

  it("STOP is still an opt-out, never a rebooking answer", async () => {
    await POST(req("STOP"));
    expect(findOpenOffer).not.toHaveBeenCalled();
    expect(handleRebookReply).not.toHaveBeenCalled();
  });
});
