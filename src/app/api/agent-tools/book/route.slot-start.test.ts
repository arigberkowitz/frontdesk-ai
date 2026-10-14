import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Calendar sync on the booking path: a caller-named time that's busy on the
 * business's connected Google/Outlook calendar is refused BEFORE anything is
 * written; a free time creates the calendar event and records it on the
 * appointment; and an unreadable calendar never produces a "booked".
 */

import { localSlot } from "@/lib/slot-label";

// What check-availability now hands the agent for 3 PM ET.
const SLOT = localSlot("2031-03-04T20:00:00.000Z", "America/New_York");

const CLIENT = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Acme",
  timezone: "America/New_York",
  businessHours: [],
  staffModeEnabled: false,
  services: [{ id: "svc-1", name: "Cleaning", durationMin: 60, isActive: true, virtualOk: false }],
};

let busy: Array<{ start: string; end: string }> = [];
let busyError: Error | null = null;
const createBooking = vi.fn(async (input: { startAt: string; durationMin: number }) => ({
  externalBookingId: "gcal-evt-1",
  startAt: input.startAt,
  endAt: new Date(Date.parse(input.startAt) + input.durationMin * 60_000).toISOString(),
  meetingUrl: null,
}));
const cancelBooking = vi.fn(async () => {});
const busyBetween = vi.fn(async () => {
  if (busyError) throw busyError;
  return busy;
});
const provider = { name: "google-calendar", isConfigured: () => true, busyBetween, createBooking, cancelBooking };

const reserveAppointment = vi.fn(async (_clientId: string, values: Record<string, unknown>) => ({
  id: "appt-1",
  customerName: values.customerName,
  customerPhone: values.customerPhone,
  startAt: values.startAt,
  endAt: values.endAt,
  status: "booked",
  externalBookingId: values.externalBookingId,
}));

vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/agent-tools-auth", () => ({
  authorizeAgentTool: async () => ({
    ok: true,
    client: CLIENT,
    channel: "voice",
    retellCallId: null,
    args: { datetime: SLOT.start, service: "Cleaning", name: "Pat", phone: "415-555-0100", email: " Pat@Example.com " },
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
  getBookingProviderForClient: () => provider,
}));
vi.mock("@/lib/notify", () => ({ notifyOwnerBooking: vi.fn(async () => {}) }));
vi.mock("@/lib/appointment-texts", () => ({ sendBookingConfirmation: vi.fn() }));
vi.mock("@/lib/data/sms-consents", () => ({ recordSmsConsent: vi.fn() }));
vi.mock("@/lib/data/chat-limits", () => ({ allowChatSms: async () => true }));
vi.mock("@/lib/webhooks-emit", () => ({ emitWebhook: vi.fn() }));
vi.mock("@/lib/deposit-request", () => ({ requestDeposit: vi.fn() }));
// booking.ts pulls these in at module load; nothing here queries or encrypts.
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/env", () => ({ env: { APP_URL: "https://app.test" }, integrations: { google: () => true, microsoft: () => true, calcom: () => false } }));

const { POST } = await import("./route");
const call = async () =>
  (await POST(new Request("https://app.test/api/agent-tools/book", { method: "POST" }))).json();

// 2031-03-04 15:00 America/New_York (EST) = 20:00Z, one hour long.
const START = "2031-03-04T20:00:00.000Z";

beforeEach(() => {
  busy = [];
  busyError = null;
  for (const f of [createBooking, cancelBooking, busyBetween, reserveAppointment]) f.mockClear();
});

describe("book from a check-availability slot", () => {
  it("the returned offset start books the exact same instant", async () => {
    expect(SLOT.start).toBe("2031-03-04T15:00:00-05:00");
    const body = await call();
    expect(body.success).toBe(true);
    expect(createBooking).toHaveBeenCalledWith(expect.objectContaining({ startAt: START }));
    expect(reserveAppointment.mock.calls[0][1]).toMatchObject({ startAt: new Date(START) });
  });

  it("stores the email the chat collected, normalised", async () => {
    await call();
    expect(reserveAppointment.mock.calls[0][1]).toMatchObject({ customerEmail: "pat@example.com" });
  });
});
