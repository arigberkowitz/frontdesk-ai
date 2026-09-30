import { beforeEach, describe, expect, it, vi } from "vitest";

/** Customer texts land in the inbox; owner alerts (no `log`) never do. */

const create = vi.fn();
const recordOutboundSms = vi.fn(async () => {});

vi.mock("twilio", () => ({ default: () => ({ messages: { create } }) }));
vi.mock("resend", () => ({ Resend: class {} }));
vi.mock("./env", () => ({
  env: { TWILIO_ACCOUNT_SID: "AC", TWILIO_AUTH_TOKEN: "t", TWILIO_FROM_NUMBER: "+18885550000" },
  integrations: { twilio: () => true, resend: () => false },
  webhookUrl: (p: string) => `https://app.test${p}`,
}));
vi.mock("./logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("./data/sms-messages", () => ({ recordOutboundSms }));

const { notifier } = await import("./notifier");

beforeEach(() => {
  create.mockReset();
  recordOutboundSms.mockClear();
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
