import { beforeEach, describe, expect, it, vi } from "vitest";

/** The owner cancellation email names the real channel (it used to say "over the phone" for texts). */

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

const { notifyOwnerCancellation } = await import("./notify");

const client = { id: "c1", name: "Bright Smile", timezone: "America/New_York", smsAlertsEnabled: true } as never;
const appt = {
  id: "a1",
  customerName: "Sam Patel",
  customerPhone: "+14155550100",
  startAt: new Date("2026-10-13T18:00:00Z"),
  notes: "Crown prep, nervous patient",
  meetingUrl: null,
} as never;

describe("notifyOwnerCancellation wording", () => {
  it.each([
    ["text", "by text (AI reply)"],
    ["chat", "via your website chat"],
    ["phone", "by phone"],
  ] as const)("a %s cancellation email says how it happened", async (source, words) => {
    sendEmail.mockClear();
    await notifyOwnerCancellation(client, appt, source);
    const { html } = sendEmail.mock.calls[0][0] as { html: string };
    expect(html).toContain(words);
    if (source !== "phone") expect(html).not.toContain("over the phone");
  });
});
