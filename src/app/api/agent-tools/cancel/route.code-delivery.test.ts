import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cancel-code delivery from the web chat: really sent, honest when it isn't,
 * and the email option only reaches the address already on the booking.
 */
const CLIENT = { id: "11111111-1111-4111-8111-111111111111", name: "Acme", timezone: "America/New_York" };
const APPT = {
  id: "appt-1", customerPhone: "+14155550100", customerName: "Pat", customerEmail: "pat@example.com",
  startAt: new Date(Date.now() + 86_400_000), endAt: new Date(Date.now() + 90_000_000),
  serviceId: null, externalBookingId: null, service: { name: "Cleaning" },
};
let appts: Array<typeof APPT | (Omit<typeof APPT, "customerEmail"> & { customerEmail: string | null })> = [APPT];
let args: Record<string, unknown> = {};
let smsResult: { ok: boolean; error?: string } = { ok: true };
let emailResult: { ok: boolean } = { ok: true };
let twilioOn = true;
let optedOut = false;
const sms: Array<{ to: string; body: string }> = [];
const emails: Array<{ to: string; text: string }> = [];

vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: { AGENT_TOOLS_SECRET: "s" }, integrations: { twilio: () => twilioOn, resend: () => true } }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/agent-tools-auth", () => ({
  authorizeAgentTool: async () => ({ ok: true, client: CLIENT, channel: "web_chat", args, call: {} }),
}));
vi.mock("@/lib/data/calls", () => ({ getCallByRetellId: async () => null }));
vi.mock("@/lib/data/appointments", () => ({
  findUpcomingAppointmentsByPhone: async (_c: string, p: string) => (p.endsWith("4155550100") ? appts : []),
  cancelAppointment: async () => APPT,
}));
vi.mock("@/lib/booking", () => ({ getBookingProviderForClient: () => ({ isConfigured: () => false }) }));
vi.mock("@/lib/notify", () => ({ notifyOwnerCancellation: vi.fn() }));
vi.mock("@/lib/agents/waitlist-backfill", () => ({ offerFreedSlot: vi.fn() }));
vi.mock("@/lib/data/sms-optouts", () => ({
  isOptedOut: async () => optedOut,
  normalizePhone: (raw: string) => raw.replace(/\D/g, "").replace(/^(\d{10})$/, "1$1"),
}));
vi.mock("@/lib/data/chat-limits", () => ({ allowChatSms: async () => true }));
vi.mock("@/lib/notifier", () => ({
  notifier: {
    sendSms: async (m: { to: string; body: string }) => (sms.push(m), smsResult),
    sendEmail: async (m: { to: string; text: string }) => (emails.push(m), emailResult),
  },
}));

const { POST } = await import("./route");
const { checkVerificationCode } = await import("@/lib/verification-code");
// A fresh client id per call keeps the per-number send throttle out of the way.
let n = 0;
const run = async (a: Record<string, unknown>) => {
  args = a;
  CLIENT.id = `11111111-1111-4111-8111-${String(++n).padStart(12, "0")}`;
  return (await POST(new Request("https://app.test/x", { method: "POST" }))).json();
};

beforeEach(() => {
  appts = [APPT]; smsResult = { ok: true }; emailResult = { ok: true }; twilioOn = true; optedOut = false;
  sms.length = 0; emails.length = 0;
});

describe("SMS code", () => {
  it("really texts a working code and tells the model to ask for it", async () => {
    const body = await run({ phone: "415-555-0100" });
    expect(sms).toHaveLength(1);
    expect(body.code_sent).toBe(true);
    expect(body.message).toMatch(/type it here/);
    const code = sms[0].body.match(/\b(\d{6})\b/)![1];
    expect(checkVerificationCode(CLIENT.id, "+14155550100", code)).toBe(true);
  });
  it("says so honestly when Twilio fails", async () => {
    smsResult = { ok: false, error: "21608" };
    const body = await run({ phone: "415-555-0100" });
    expect(body.code_sent).toBe(false);
    expect(body.message).toMatch(/couldn't be sent/);
  });
  it("is honest when texting is off or the number opted out", async () => {
    twilioOn = false;
    expect((await run({ phone: "415-555-0100" })).message).toMatch(/no code was sent/);
    twilioOn = true; optedOut = true;
    expect((await run({ phone: "415-555-0100" })).message).toMatch(/opted out/);
    expect(sms).toHaveLength(0);
  });
  it("an unknown number gets the generic answer and nothing is sent", async () => {
    const body = await run({ phone: "212-555-0199" });
    expect(sms).toHaveLength(0);
    expect(body.code_sent).toBe("unknown");
  });
});

describe("email code", () => {
  it("emails the code only to the address on the booking (case-insensitive)", async () => {
    const body = await run({ phone: "4155550100", via: "email", email: " Pat@Example.com " });
    expect(emails).toHaveLength(1);
    expect(emails[0].to).toBe("pat@example.com");
    expect(sms).toHaveLength(0);
    const code = emails[0].text.match(/\b(\d{6})\b/)![1];
    expect(checkVerificationCode(CLIENT.id, "+14155550100", code)).toBe(true);
    expect(body.code_sent).toBe(true);
  });
  it("never emails an address that isn't on the booking, and doesn't reveal that", async () => {
    const body = await run({ phone: "4155550100", via: "email", email: "attacker@evil.test" });
    expect(emails).toHaveLength(0);
    expect(body.code_sent).toBe("unknown");
    expect(JSON.stringify(body)).not.toContain("pat@example.com");
  });
  it("a booking with no email can't get an email code (SMS only)", async () => {
    appts = [{ ...APPT, customerEmail: null }];
    const body = await run({ phone: "4155550100", via: "email", email: "pat@example.com" });
    expect(emails).toHaveLength(0);
    expect(body.message).toMatch(/text the code/);
  });
  it("asks for the email when none (or junk) is given", async () => {
    const body = await run({ phone: "4155550100", via: "email", email: "nope" });
    expect(emails).toHaveLength(0);
    expect(body.message).toMatch(/email address they used/);
  });
  it("the emailed code cancels", async () => {
    await run({ phone: "4155550100", via: "email", email: "pat@example.com" });
    const code = emails[0].text.match(/\b(\d{6})\b/)![1];
    args = { phone: "4155550100", code };
    const body = await (await POST(new Request("https://app.test/x", { method: "POST" }))).json();
    expect(body.success).toBe(true);
  });
});
