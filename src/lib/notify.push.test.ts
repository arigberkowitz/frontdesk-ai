import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A new booking also pings the owner's opted-in devices, alongside (not
 * instead of) the email/SMS alert, and a push problem never stops the alert.
 */

const pushToClient = vi.fn(async (..._a: unknown[]) => ({ sent: 1, removed: 0, failed: 0 }));
const sendEmail = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
const sendSms = vi.fn(async (..._a: unknown[]) => ({ ok: true }));

vi.mock("@/db", () => ({ db: { insert: () => ({ values: async () => undefined }) } }));
vi.mock("./notifier", () => ({ notifier: { sendEmail, sendSms } }));
vi.mock("./data/alert-contacts", () => ({
  getAlertRecipients: async () => ({ emails: ["owner@bright.test"], phones: ["+14155550199"] }),
}));
vi.mock("./env", () => ({ env: {} }));
vi.mock("./logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("./push", () => ({ pushToClient: (...a: unknown[]) => pushToClient(...a) }));

const { notifyOwnerBooking } = await import("./notify");

const client = { id: "c1", name: "Bright Smile", timezone: "America/New_York", smsAlertsEnabled: true } as never;
const appt = {
  id: "a1",
  customerName: "Sam Patel",
  customerPhone: "+14155550100",
  startAt: new Date("2026-10-13T18:00:00Z"),
  notes: "Crown prep, nervous patient",
  meetingUrl: null,
} as never;

beforeEach(() => {
  for (const f of [pushToClient, sendEmail, sendSms]) f.mockClear();
});

describe("notifyOwnerBooking × phone notifications", () => {
  it("pushes who and when — not notes or service — and still emails and texts", async () => {
    await notifyOwnerBooking(client, appt);
    expect(pushToClient).toHaveBeenCalledTimes(1);
    const [clientId, kind, payload] = pushToClient.mock.calls[0] as [string, string, Record<string, string>];
    expect(clientId).toBe("c1");
    expect(kind).toBe("booking");
    expect(payload.title).toBe("New booking: Sam Patel");
    expect(payload.body).toMatch(/2:00\s?PM/);
    expect(JSON.stringify(payload)).not.toMatch(/Crown|nervous/);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendSms).toHaveBeenCalledTimes(1);
  });
});
