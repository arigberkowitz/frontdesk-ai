import { beforeEach, describe, expect, it, vi } from "vitest";

const dueSms = vi.fn();
const markSms = vi.fn(async () => {});
const getTextingPrefs = vi.fn();
const isOptedOut = vi.fn(async () => false);
const sendSms = vi.fn(async () => ({ ok: true, id: "SM9" }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/data/texting-prefs", () => ({ dueSms, markSms, getTextingPrefs }));
vi.mock("@/lib/data/sms-optouts", () => ({ isOptedOut }));
vi.mock("@/lib/notifier", () => ({ notifier: { sendSms } }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn() } }));

const { flushSmsQueue } = await import("./sms-queue");
const row = (id: string) => ({ id, clientId: "c1", toPhone: "+14155550100", body: "hi", log: { clientId: "c1", kind: "x" } });

beforeEach(() => {
  vi.clearAllMocks();
  getTextingPrefs.mockResolvedValue({ textingEnabled: true });
});

describe("flushSmsQueue", () => {
  it("sends due texts, bypassing re-queueing", async () => {
    dueSms.mockResolvedValue([row("q1")]);
    expect(await flushSmsQueue()).toEqual({ sent: 1, dropped: 0, failed: 0 });
    expect(sendSms).toHaveBeenCalledWith(expect.objectContaining({ fromQueue: true }));
    expect(markSms).toHaveBeenCalledWith("q1", "sent", "SM9");
  });

  it("drops texts if the customer texted STOP overnight", async () => {
    dueSms.mockResolvedValue([row("q2")]);
    isOptedOut.mockResolvedValueOnce(true);
    expect((await flushSmsQueue()).dropped).toBe(1);
    expect(sendSms).not.toHaveBeenCalled();
    expect(markSms).toHaveBeenCalledWith("q2", "dropped", "opted_out");
  });

  it("drops texts if the owner turned texting off", async () => {
    dueSms.mockResolvedValue([row("q3")]);
    getTextingPrefs.mockResolvedValue({ textingEnabled: false });
    await flushSmsQueue();
    expect(sendSms).not.toHaveBeenCalled();
    expect(markSms).toHaveBeenCalledWith("q3", "dropped", "texting_off");
  });
});
