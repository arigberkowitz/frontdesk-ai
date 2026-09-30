import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The inbound SMS webhook end to end (dependencies mocked): signature gate,
 * STOP/HELP/START still handled exactly as before, every inbound message
 * handed to the inbox with its MessageSid, and Twilio replays not re-emailed.
 */

const TOKEN = "test-auth-token";
const URL_ = "https://frontdeskai.company/api/webhooks/twilio";
const OWNER = { id: "c-owner", ownerEmail: "owner@biz.test" };

const calls: string[] = [];
const recordOptOut = vi.fn(async () => {
  calls.push("recordOptOut");
});
const removeOptOut = vi.fn(async () => {
  calls.push("removeOptOut");
});
const storeInboundMessage = vi.fn(async (_input: Record<string, unknown>) => {
  calls.push("store");
  return { owner: OWNER as typeof OWNER | null, isNew: true };
});
const updateSmsDeliveryStatus = vi.fn(async () => {});
const sendEmail = vi.fn(async () => ({ ok: true }));
const leadFind = vi.fn(async () => ({ id: "lead-1", name: "Pat" }) as { id: string; name: string } | undefined);
const dbUpdateWhere = vi.fn(async () => {});

vi.mock("@/lib/env", () => ({
  env: { TWILIO_AUTH_TOKEN: "test-auth-token" },
  webhookUrl: (p: string) => `https://frontdeskai.company${p}`,
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/data/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/data/sms-optouts", () => ({
  recordOptOut,
  removeOptOut,
  normalizePhone: (raw: string) => {
    const d = raw.replace(/[^\d]/g, "");
    return d.length === 10 ? `1${d}` : d;
  },
}));
vi.mock("@/lib/sms-inbox", () => ({ storeInboundMessage }));
// Per-business texting numbers: null = the shared number (default in these tests).
const ownLine = vi.fn(async (_to: string) => null as { id: string } | null);
vi.mock("@/lib/data/sms-numbers", () => ({ findClientBySmsNumber: (to: string) => ownLine(to) }));
vi.mock("@/lib/data/sms-messages", () => ({ updateSmsDeliveryStatus }));
vi.mock("@/lib/notifier", () => ({
  notifier: { sendEmail },
  explainSmsError: (_c: unknown, fallback: string) => fallback,
}));
vi.mock("@/db", () => ({
  db: {
    query: { leads: { findFirst: leadFind } },
    update: () => ({ set: () => ({ where: dbUpdateWhere }) }),
  },
}));

const { POST } = await import("./route");

function sign(params: Record<string, string>, token = TOKEN, url = URL_): string {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  return createHmac("sha1", token).update(data).digest("base64");
}

function twilioRequest(params: Record<string, string>, signature = sign(params)): Request {
  return new Request(URL_, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": signature,
      host: "frontdeskai.company",
    },
    body: new URLSearchParams(params).toString(),
  });
}

const inbound = (Body: string, MessageSid = "SM_1") => ({
  From: "+14155550100",
  To: "+18885550000",
  Body,
  MessageSid,
});

beforeEach(() => {
  calls.length = 0;
  for (const f of [recordOptOut, removeOptOut, storeInboundMessage, updateSmsDeliveryStatus, sendEmail, dbUpdateWhere]) {
    f.mockClear();
  }
  ownLine.mockReset().mockResolvedValue(null);
  storeInboundMessage.mockImplementation(async () => {
    calls.push("store");
    return { owner: OWNER, isNew: true };
  });
});

describe("Twilio inbound webhook", () => {
  it("rejects a bad signature and stores nothing", async () => {
    const res = await POST(twilioRequest(inbound("hello"), "forged"));
    expect(res.status).toBe(401);
    expect(storeInboundMessage).not.toHaveBeenCalled();
    expect(recordOptOut).not.toHaveBeenCalled();
  });

  it("rejects params that were tampered with after signing", async () => {
    const params = inbound("hello");
    const res = await POST(twilioRequest({ ...params, Body: "STOP" }, sign(params)));
    expect(res.status).toBe(401);
  });

  it("stores a reply with its MessageSid and emails the owner", async () => {
    const res = await POST(twilioRequest(inbound("Can we do 3pm?")));
    expect(res.status).toBe(200);
    expect(storeInboundMessage).toHaveBeenCalledWith({
      from: "+14155550100",
      to: "+18885550000",
      body: "Can we do 3pm?",
      messageSid: "SM_1",
      kind: "reply",
    });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("does not email the owner again on a Twilio replay of the same MessageSid", async () => {
    storeInboundMessage.mockResolvedValue({ owner: OWNER, isNew: false });
    await POST(twilioRequest(inbound("Can we do 3pm?")));
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("STOP: records the opt-out FIRST, then logs the message, and stays silent", async () => {
    const res = await POST(twilioRequest(inbound("STOP")));
    expect(calls).toEqual(["recordOptOut", "store"]);
    expect(storeInboundMessage.mock.calls[0][0]).toMatchObject({ kind: "opt_out", body: "STOP" });
    expect(await res.text()).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("STOP still opts out even when the inbox can't attribute the message", async () => {
    storeInboundMessage.mockResolvedValue({ owner: null, isNew: true });
    await POST(twilioRequest(inbound("stop texting me please")));
    expect(recordOptOut).toHaveBeenCalledTimes(1);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("HELP: logs the message and still answers with the help text", async () => {
    const res = await POST(twilioRequest(inbound("HELP")));
    expect(storeInboundMessage.mock.calls[0][0]).toMatchObject({ kind: "help" });
    expect(await res.text()).toContain("Reply STOP to opt out");
  });

  it("YES/START: re-subscribes, logs as opt_in, and still reaches the owner", async () => {
    await POST(twilioRequest(inbound("YES")));
    expect(calls).toEqual(["removeOptOut", "store"]);
    expect(storeInboundMessage.mock.calls[0][0]).toMatchObject({ kind: "opt_in" });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("status callbacks update delivery state and are not stored as messages", async () => {
    await POST(twilioRequest({ MessageSid: "SM_out", MessageStatus: "delivered" }));
    expect(updateSmsDeliveryStatus).toHaveBeenCalledWith("SM_out", "delivered");
    await POST(twilioRequest({ MessageSid: "SM_out2", MessageStatus: "undelivered", ErrorCode: "30003" }));
    expect(updateSmsDeliveryStatus).toHaveBeenCalledWith("SM_out2", "failed", expect.any(String));
    expect(storeInboundMessage).not.toHaveBeenCalled();
  });

  describe("per-business texting numbers", () => {
    const DEDICATED = "+14155559999";
    const toOwn = (Body: string) => ({ ...inbound(Body), To: DEDICATED });

    it("STOP to the shared number opts out for every business (unscoped, as before)", async () => {
      await POST(twilioRequest(inbound("STOP")));
      expect(recordOptOut).toHaveBeenCalledWith("+14155550100", "stop", null);
    });

    it("STOP to a business's own number opts out for THAT business only", async () => {
      ownLine.mockResolvedValue({ id: "c-own" });
      await POST(twilioRequest(toOwn("STOP")));
      expect(ownLine).toHaveBeenCalledWith(DEDICATED);
      expect(recordOptOut).toHaveBeenCalledWith("+14155550100", "stop", {
        clientId: "c-own",
        businessPhone: DEDICATED,
      });
      // Still recorded before storing, and still silent.
      expect(calls).toEqual(["recordOptOut", "store"]);
    });

    it("START to a business's own number lifts only that business's opt-out", async () => {
      ownLine.mockResolvedValue({ id: "c-own" });
      await POST(twilioRequest(toOwn("START")));
      expect(removeOptOut).toHaveBeenCalledWith("+14155550100", {
        clientId: "c-own",
        businessPhone: DEDICATED,
      });
    });

    it("START to the shared number lifts the shared opt-out (unscoped)", async () => {
      await POST(twilioRequest(inbound("START")));
      expect(removeOptOut).toHaveBeenCalledWith("+14155550100", null);
    });

    it("an unknown number falls back to the broader shared-number scope for STOP", async () => {
      ownLine.mockResolvedValue(null);
      await POST(twilioRequest(toOwn("STOP")));
      expect(recordOptOut).toHaveBeenCalledWith("+14155550100", "stop", null);
    });

    it("ordinary replies don't pay for the number lookup (routing happens in the inbox)", async () => {
      await POST(twilioRequest(toOwn("Running 5 min late")));
      expect(ownLine).not.toHaveBeenCalled();
      expect(storeInboundMessage.mock.calls[0][0]).toMatchObject({ to: DEDICATED, kind: "reply" });
    });
  });
});
