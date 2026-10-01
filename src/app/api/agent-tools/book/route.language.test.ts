import { beforeEach, describe, expect, it, vi } from "vitest";

/** The book tool carries the caller's language through to the texts and the consent receipt. */

const CLIENT = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Acme",
  timezone: "America/New_York",
  businessHours: [],
  staffModeEnabled: false,
  services: [{ id: "svc-1", name: "Cleaning", durationMin: 60, isActive: true, virtualOk: false }],
};
const provider = {
  name: "google-calendar",
  isConfigured: () => true,
  busyBetween: async () => [],
  createBooking: async (input: { startAt: string; durationMin: number }) => ({
    externalBookingId: "gcal-1",
    startAt: input.startAt,
    endAt: new Date(Date.parse(input.startAt) + input.durationMin * 60_000).toISOString(),
    meetingUrl: null,
  }),
  cancelBooking: async () => {},
};
const args: Record<string, unknown> = {};
const afterTasks: (() => unknown)[] = [];
vi.mock("next/server", () => ({ after: (fn: () => unknown) => afterTasks.push(fn) }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/agent-tools-auth", () => ({
  authorizeAgentTool: async () => ({ ok: true, client: CLIENT, channel: "voice", retellCallId: null, args }),
}));
vi.mock("@/lib/data/calls", () => ({ getCallByRetellId: async () => null }));
vi.mock("@/lib/data/appointments", () => ({
  hasOverlappingAppointment: async () => false,
  reserveAppointment: async (_c: string, v: Record<string, unknown>) => ({ id: "appt-1", status: "booked", ...v }),
}));
vi.mock("@/lib/data/providers", () => ({ findFreeProvider: async () => null }));
vi.mock("@/lib/data/availability-blocks", () => ({ listActiveBlocks: async () => [] }));
vi.mock("@/lib/booking", async (orig) => ({
  ...(await orig<typeof import("@/lib/booking")>()),
  getBookingProviderForClient: () => provider,
}));
vi.mock("@/lib/notify", () => ({ notifyOwnerBooking: vi.fn(async () => {}) }));
const sendBookingConfirmation = vi.fn(async () => {});
vi.mock("@/lib/appointment-texts", () => ({ sendBookingConfirmation }));
const recordSmsConsent = vi.fn(async () => {});
vi.mock("@/lib/data/sms-consents", () => ({ recordSmsConsent }));
const rememberCustomerLanguage = vi.fn(async () => {});
vi.mock("@/lib/data/customer-languages", () => ({ rememberCustomerLanguage }));
vi.mock("@/lib/data/chat-limits", () => ({ allowChatSms: async () => true }));
vi.mock("@/lib/webhooks-emit", () => ({ emitWebhook: vi.fn() }));
vi.mock("@/lib/deposit-request", () => ({ requestDeposit: vi.fn() }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/env", () => ({ env: { APP_URL: "https://app.test" }, integrations: { google: () => true, microsoft: () => true, calcom: () => false } }));

const { POST } = await import("./route");
async function book(extra: Record<string, unknown>) {
  Object.keys(args).forEach((k) => delete args[k]);
  Object.assign(args, { datetime: "2031-03-04T15:00:00", service: "Cleaning", name: "Pat", phone: "415-555-0100", ...extra });
  const body = await (await POST(new Request("https://app.test/api/agent-tools/book", { method: "POST" }))).json();
  for (const t of afterTasks.splice(0)) await t();
  return body;
}

beforeEach(() => {
  afterTasks.length = 0;
  for (const f of [sendBookingConfirmation, recordSmsConsent, rememberCustomerLanguage]) f.mockClear();
});

describe("book tool × caller language", () => {
  it("Spanish: remembered, the consent receipt says so, and the confirmation goes out in Spanish", async () => {
    const body = await book({ sms_consent: true, language: "Español" });
    expect(body.success).toBe(true);
    expect(rememberCustomerLanguage).toHaveBeenCalledWith({ clientId: CLIENT.id, phone: "+14155550100", language: "es" });
    expect(recordSmsConsent).toHaveBeenCalledWith(expect.objectContaining({ language: "es" }));
    expect(sendBookingConfirmation).toHaveBeenCalledWith(CLIENT, expect.anything(), "Cleaning", "es");
  });

  it("no language (English-only agents) changes nothing", async () => {
    await book({ sms_consent: true });
    expect(rememberCustomerLanguage).not.toHaveBeenCalled();
    expect(recordSmsConsent).toHaveBeenCalledWith(expect.objectContaining({ language: null }));
    expect(sendBookingConfirmation).toHaveBeenCalledWith(CLIENT, expect.anything(), "Cleaning", null);
  });

  it("an unsupported language is ignored, not stored", async () => {
    await book({ sms_consent: false, language: "Klingon" });
    expect(rememberCustomerLanguage).not.toHaveBeenCalled();
    expect(sendBookingConfirmation).not.toHaveBeenCalled();
  });
});
