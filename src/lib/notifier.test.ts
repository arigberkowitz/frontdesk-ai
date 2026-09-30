import { beforeEach, describe, expect, it, vi } from "vitest";

/** Customer texts land in the inbox; owner alerts (no `log`) never do. */

const create = vi.fn();
const recordOutboundSms = vi.fn(async () => {});

const list = vi.fn();
vi.mock("twilio", () => ({ default: () => ({ messages: { create }, incomingPhoneNumbers: { list } }) }));
// Per-business texting numbers: c-own has one, everyone else uses the shared number.
const getClientSmsNumber = vi.fn(async (id: string) => (id === "c-own" ? "+14155559999" : null));
vi.mock("./data/sms-numbers", () => ({ getClientSmsNumber: (id: string) => getClientSmsNumber(id) }));
vi.mock("resend", () => ({ Resend: class {} }));
vi.mock("./env", () => ({
  env: { TWILIO_ACCOUNT_SID: "AC", TWILIO_AUTH_TOKEN: "t", TWILIO_FROM_NUMBER: "+18885550000" },
  integrations: { twilio: () => true, resend: () => false },
  webhookUrl: (p: string) => `https://app.test${p}`,
}));
vi.mock("./logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("./data/sms-messages", () => ({ recordOutboundSms }));

const { notifier, checkTwilioNumber } = await import("./notifier");

beforeEach(() => {
  create.mockReset();
  recordOutboundSms.mockClear();
  getClientSmsNumber.mockClear();
  list.mockReset();
});

describe("notifier.sendSms sending number", () => {
  it("sends a business's customer text FROM its own number and records that number", async () => {
    create.mockResolvedValue({ sid: "SM_own" });
    const log = { clientId: "c-own", kind: "appointment_reminder" };
    await notifier.sendSms({ to: "+14155550100", body: "Reminder", log });
    expect(create.mock.calls[0][0]).toMatchObject({ from: "+14155559999", to: "+14155550100" });
    expect(recordOutboundSms).toHaveBeenCalledWith(log, expect.objectContaining({ from: "+14155559999" }));
  });

  it("falls back to the shared number when the business has none", async () => {
    create.mockResolvedValue({ sid: "SM_shared" });
    await notifier.sendSms({ to: "+14155550100", body: "x", log: { clientId: "c-plain", kind: "recall" } });
    expect(create.mock.calls[0][0]).toMatchObject({ from: "+18885550000" });
  });

  it("fromClientId picks the number for unlogged customer texts (cancel codes)", async () => {
    create.mockResolvedValue({ sid: "SM_code" });
    await notifier.sendSms({ to: "+14155550100", body: "Code 123456", fromClientId: "c-own" });
    expect(create.mock.calls[0][0]).toMatchObject({ from: "+14155559999" });
    expect(recordOutboundSms).not.toHaveBeenCalled();
  });

  it("owner alerts (no business given) always use the shared number, with no lookup", async () => {
    create.mockResolvedValue({ sid: "SM_alert" });
    await notifier.sendSms({ to: "+14155550111", body: "New booking" });
    expect(create.mock.calls[0][0]).toMatchObject({ from: "+18885550000" });
    expect(getClientSmsNumber).not.toHaveBeenCalled();
  });
});

describe("checkTwilioNumber (read-only)", () => {
  it("reports a number in the account with our webhook as usable", async () => {
    list.mockResolvedValue([{ smsUrl: "https://app.test/api/webhooks/twilio", capabilities: { sms: true } }]);
    const r = await checkTwilioNumber("(415) 555-9999");
    expect(list).toHaveBeenCalledWith({ phoneNumber: "+14155559999", limit: 1 });
    expect(r).toMatchObject({ checked: true, found: true, smsCapable: true, webhookOk: true, isShared: false });
    expect(create).not.toHaveBeenCalled();
  });

  it("flags a missing number, a wrong webhook, and the shared number", async () => {
    list.mockResolvedValue([]);
    expect(await checkTwilioNumber("+14155559999")).toMatchObject({ checked: true, found: false });
    list.mockResolvedValue([{ smsUrl: "https://demo.twilio.com/welcome/sms/reply", capabilities: { sms: true } }]);
    expect(await checkTwilioNumber("+14155559999")).toMatchObject({ found: true, webhookOk: false });
    list.mockResolvedValue([{ smsUrl: "", capabilities: { sms: true } }]);
    expect(await checkTwilioNumber("888-555-0000")).toMatchObject({ isShared: true });
  });
});

describe("notifier.sendSms inbox logging", () => {
  it("records a successful customer text with its sid", async () => {
    create.mockResolvedValue({ sid: "SM_ok" });
    const log = { clientId: "c1", kind: "appointment_reminder", appointmentId: "a1" };
    const r = await notifier.sendSms({ to: "+14155550100", body: "See you tomorrow", log });
    expect(r).toEqual({ ok: true, id: "SM_ok" });
    expect(recordOutboundSms).toHaveBeenCalledWith(log, {
      to: "+14155550100",
      from: "+18885550000",
      body: "See you tomorrow",
      ok: true,
      providerSid: "SM_ok",
      error: null,
    });
  });

  it("records a failed customer text as failed", async () => {
    create.mockRejectedValue(Object.assign(new Error("nope"), { code: 21211 }));
    const r = await notifier.sendSms({ to: "+14155550100", body: "x", log: { clientId: "c1", kind: "recall" } });
    expect(r.ok).toBe(false);
    expect(recordOutboundSms).toHaveBeenCalledWith(
      { clientId: "c1", kind: "recall" },
      expect.objectContaining({ ok: false, error: "nope (Twilio 21211)" }),
    );
  });

  it("does not record texts sent without a log context (owner alerts, codes)", async () => {
    create.mockResolvedValue({ sid: "SM_alert" });
    await notifier.sendSms({ to: "+14155550100", body: "New lead!" });
    expect(recordOutboundSms).not.toHaveBeenCalled();
  });
});
