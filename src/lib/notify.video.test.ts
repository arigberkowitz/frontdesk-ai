import { beforeEach, describe, expect, it, vi } from "vitest";

/** The owner is told when a video appointment was booked but its link couldn't be made. */

const sendEmail = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
const sendSms = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
vi.mock("@/db", () => ({ db: { insert: () => ({ values: async () => undefined }) } }));
vi.mock("./notifier", () => ({ notifier: { sendEmail, sendSms } }));
vi.mock("./data/alert-contacts", () => ({
  getAlertRecipients: async () => ({ emails: ["owner@acme.test"], phones: ["+14155550199"] }),
}));
vi.mock("./env", () => ({ env: { APP_URL: "https://app.test" } }));
vi.mock("./logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("./push", () => ({ pushToClient: vi.fn() }));

const { notifyOwnerVideoLinkFailed } = await import("./notify");
const client = { id: "c1", name: "Acme Law", timezone: "America/New_York", smsAlertsEnabled: true } as never;
const appt = { id: "a1", customerName: "Pat Lee", customerPhone: "+14155550100", startAt: new Date("2031-03-04T20:00:00Z") };

beforeEach(() => {
  sendEmail.mockClear();
  sendSms.mockClear();
});

describe("notifyOwnerVideoLinkFailed", () => {
  it("texts and emails: who, when, that they got no link, and how to fix it", async () => {
    await notifyOwnerVideoLinkFailed(client, appt, { reason: "no_link", detail: "The calendar didn't return a video link for this booking." });
    const sms = sendSms.mock.calls[0][0] as { body: string };
    expect(sms.body).toMatch(/Pat Lee booked a video appointment/);
    expect(sms.body).toMatch(/not sent a link/);
    const mail = sendEmail.mock.calls[0][0] as { html: string; subject: string };
    expect(mail.subject).toMatch(/Video link missing/);
    expect(mail.html).toMatch(/\(415\)|415/);
    expect(mail.html).toMatch(/Send them a video link yourself/);
  });

  it("a Zoom connection problem points at Settings → Calendar", async () => {
    await notifyOwnerVideoLinkFailed(client, appt, { reason: "zoom_reconnect", detail: "Zoom access expired." });
    const mail = sendEmail.mock.calls[0][0] as { html: string };
    expect(mail.html).toContain("https://app.test/portal/settings/calendar");
    expect(mail.html).toMatch(/Reconnect Zoom/);
  });

  it("a suspended business gets nothing", async () => {
    await notifyOwnerVideoLinkFailed({ ...(client as object), setupFlags: { suspended: true } } as never, appt, { reason: "no_link", detail: "x" });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
