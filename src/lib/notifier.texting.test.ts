import { beforeEach, describe, expect, it, vi } from "vitest";

/** Owner texting controls inside notifier.sendSms (all Twilio and DB mocked). */
const create = vi.fn(async () => ({ sid: "SM1" }));
const getTextingPrefs = vi.fn();
const enqueueSms = vi.fn(async () => {});
const flags = { OWNER_TEXTING_CONTROLS: true };

vi.mock("twilio", () => ({ default: () => ({ messages: { create } }) }));
vi.mock("resend", () => ({ Resend: class {} }));
vi.mock("./data/sms-numbers", () => ({ getClientSmsNumber: async () => null }));
vi.mock("./data/sms-messages", () => ({ recordOutboundSms: async () => {} }));
vi.mock("./data/texting-prefs", () => ({ getTextingPrefs, enqueueSms }));
vi.mock("./logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("./env", () => ({
  env: new Proxy({ TWILIO_ACCOUNT_SID: "AC", TWILIO_AUTH_TOKEN: "t", TWILIO_FROM_NUMBER: "+18885550000" } as Record<string, unknown>, {
    get: (t, k: string) => (k in flags ? flags[k as keyof typeof flags] : t[k]),
  }),
  integrations: { twilio: () => true, resend: () => false },
  webhookUrl: (p: string) => `https://app.test${p}`,
}));

const { notifier } = await import("./notifier");
const auto = { to: "+14155550100", body: "Reminder", log: { clientId: "c1", kind: "appointment_reminder" } };
const prefs = (o: object = {}) => ({ textingEnabled: true, quietStartHour: 21, quietEndHour: 8, timeZone: "America/New_York", ...o });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-04T15:00:00Z")); // 10 AM ET
  create.mockClear();
  enqueueSms.mockClear();
  getTextingPrefs.mockReset();
  flags.OWNER_TEXTING_CONTROLS = true;
});

describe("texting switch", () => {
  it("off: automated customer texts are not sent", async () => {
    getTextingPrefs.mockResolvedValue(prefs({ textingEnabled: false }));
    const r = await notifier.sendSms(auto);
    expect(r).toMatchObject({ ok: false, skipped: true, error: expect.stringMatching(/turned off/) });
    expect(create).not.toHaveBeenCalled();
  });

  it("off: the owner's own portal reply still sends", async () => {
    getTextingPrefs.mockResolvedValue(prefs({ textingEnabled: false }));
    expect((await notifier.sendSms({ ...auto, manual: true })).ok).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("owner alerts (no customer log) are untouched", async () => {
    getTextingPrefs.mockResolvedValue(prefs({ textingEnabled: false }));
    await notifier.sendSms({ to: "+14155550111", body: "New booking" });
    expect(create).toHaveBeenCalledTimes(1);
    expect(getTextingPrefs).not.toHaveBeenCalled();
  });

  it("flag off: no prefs lookup, sends as today", async () => {
    flags.OWNER_TEXTING_CONTROLS = false;
    await notifier.sendSms(auto);
    expect(getTextingPrefs).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("prefs lookup failure sends as before", async () => {
    getTextingPrefs.mockResolvedValue(null);
    expect((await notifier.sendSms(auto)).ok).toBe(true);
  });
});

describe("quiet hours", () => {
  it("queues an automated text at 11 PM ET for 8 AM ET", async () => {
    vi.setSystemTime(new Date("2026-11-05T04:00:00Z"));
    getTextingPrefs.mockResolvedValue(prefs());
    const r = await notifier.sendSms(auto);
    expect(r).toEqual({ ok: true, queued: true });
    expect(create).not.toHaveBeenCalled();
    expect(enqueueSms).toHaveBeenCalledWith(expect.objectContaining({ to: auto.to, sendAfter: new Date("2026-11-05T13:00:00Z") }));
  });

  it("manual replies during quiet hours send now", async () => {
    vi.setSystemTime(new Date("2026-11-05T04:00:00Z"));
    getTextingPrefs.mockResolvedValue(prefs());
    await notifier.sendSms({ ...auto, manual: true });
    expect(create).toHaveBeenCalledTimes(1);
    expect(enqueueSms).not.toHaveBeenCalled();
  });

  it("released queue texts are not re-held", async () => {
    vi.setSystemTime(new Date("2026-11-05T04:00:00Z"));
    getTextingPrefs.mockResolvedValue(prefs());
    await notifier.sendSms({ ...auto, fromQueue: true });
    expect(create).toHaveBeenCalledTimes(1);
  });
});
