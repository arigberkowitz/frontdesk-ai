import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Booking by text (AI text replies, channel "sms"): the appointment goes under
 * the number that is texting — never a number typed into the conversation —
 * and no consent receipt / separate confirmation series is started from it.
 */

const CLIENT = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Acme",
  timezone: "America/New_York",
  businessHours: [],
  staffModeEnabled: false,
  services: [{ id: "svc-1", name: "Cleaning", durationMin: 60, isActive: true, virtualOk: false }],
};

let args: Record<string, unknown> = {};
let channel = "sms";
const reserveAppointment = vi.fn(async (_c: string, v: Record<string, unknown>) => ({ id: "appt-1", ...v }));
const recordSmsConsent = vi.fn((..._a: unknown[]) => undefined);
const sendBookingConfirmation = vi.fn(async (..._a: unknown[]) => {});
const requestDeposit = vi.fn((..._a: unknown[]) => undefined);

vi.mock("next/server", () => ({ after: (fn: () => unknown) => fn() }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn((..._a: unknown[]) => undefined), warn: vi.fn((..._a: unknown[]) => undefined), error: vi.fn((..._a: unknown[]) => undefined) } }));
vi.mock("@/lib/agent-tools-auth", () => ({
  authorizeAgentTool: async () => ({
    ok: true,
    client: CLIENT,
    channel,
    retellCallId: undefined,
    args,
    call: { fromNumber: "+14155550100" },
  }),
}));
vi.mock("@/lib/data/calls", () => ({ getCallByRetellId: async () => null }));
vi.mock("@/lib/data/appointments", () => ({
  hasOverlappingAppointment: async () => false,
  reserveAppointment: (c: string, v: Record<string, unknown>) => reserveAppointment(c, v),
}));
vi.mock("@/lib/data/providers", () => ({ findFreeProvider: async () => null }));
vi.mock("@/lib/data/availability-blocks", () => ({ listActiveBlocks: async () => [] }));
vi.mock("@/lib/booking", async (orig) => ({
  ...(await orig<typeof import("@/lib/booking")>()),
  getBookingProviderForClient: () => ({ isConfigured: () => false }),
}));
vi.mock("@/lib/notify", () => ({ notifyOwnerBooking: vi.fn(async (..._a: unknown[]) => {}) }));
vi.mock("@/lib/appointment-texts", () => ({ sendBookingConfirmation: (...a: unknown[]) => sendBookingConfirmation(...a) }));
vi.mock("@/lib/data/sms-consents", () => ({ recordSmsConsent: (...a: unknown[]) => recordSmsConsent(...a) }));
vi.mock("@/lib/data/chat-limits", () => ({ allowChatSms: async () => true }));
vi.mock("@/lib/webhooks-emit", () => ({ emitWebhook: vi.fn((..._a: unknown[]) => undefined) }));
vi.mock("@/lib/deposit-request", () => ({ requestDeposit: (...a: unknown[]) => requestDeposit(...a) }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/env", () => ({
  env: { APP_URL: "https://app.test" },
  integrations: { google: () => false, microsoft: () => false, calcom: () => false },
}));

const { POST } = await import("./route");
const call = async () => (await POST(new Request("https://app.test/api/agent-tools/book", { method: "POST" }))).json();

beforeEach(() => {
  channel = "sms";
  args = { datetime: "2031-03-04T15:00:00", service: "Cleaning", name: "Pat" };
  for (const f of [reserveAppointment, recordSmsConsent, sendBookingConfirmation, requestDeposit]) f.mockClear();
});

describe("book tool × AI text replies", () => {
  it("books under the texting number", async () => {
    const body = await call();
    expect(body.success).toBe(true);
    expect(reserveAppointment.mock.calls[0][1]).toMatchObject({ customerPhone: "+14155550100", customerName: "Pat" });
  });

  it("ignores a different number typed into the conversation", async () => {
    args = { ...args, phone: "212-555-0199" };
    await call();
    expect(reserveAppointment.mock.calls[0][1]).toMatchObject({ customerPhone: "+14155550100" });
  });

  it("an injected sms_consent:true starts no consent receipt or confirmation texts", async () => {
    args = { ...args, sms_consent: true };
    await call();
    expect(recordSmsConsent).not.toHaveBeenCalled();
    expect(sendBookingConfirmation).not.toHaveBeenCalled();
    expect(requestDeposit).toHaveBeenCalledWith(expect.objectContaining({ smsConsent: false }));
  });

  it("voice behavior is unchanged (consent still recorded on a spoken yes)", async () => {
    channel = "voice";
    args = { ...args, phone: "415-555-0100", sms_consent: true };
    await call();
    expect(recordSmsConsent).toHaveBeenCalled();
  });
});
