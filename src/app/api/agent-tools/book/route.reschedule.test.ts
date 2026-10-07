import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * AI text replies (#19): rescheduling is ONE book_appointment call with
 * `reschedule_from`. The old appointment's Google/Outlook event is moved in
 * place (same id), the old time is released locally, and a calendar failure
 * never blocks the move. Every provider call is mocked.
 */

const CLIENT = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Acme",
  timezone: "America/New_York",
  businessHours: [],
  staffModeEnabled: false,
  services: [{ id: "svc-1", name: "Cleaning", durationMin: 60, isActive: true, virtualOk: false }],
};

// Old appointment: 2031-03-03 10:00 New York = 15:00Z.
const OLD = {
  id: "appt-old",
  clientId: CLIENT.id,
  customerName: "Pat",
  customerPhone: "+14155550100",
  serviceId: "svc-1",
  startAt: new Date("2031-03-03T15:00:00.000Z"),
  endAt: new Date("2031-03-03T16:00:00.000Z"),
  status: "booked",
  externalBookingId: "gcal-evt-old",
  meetingUrl: null,
  service: { name: "Cleaning" },
};

let args: Record<string, unknown> = {};
let channel = "sms";
let upcoming: Array<typeof OLD> = [];
const createBooking = vi.fn(async (input: { startAt: string; durationMin: number }) => ({
  externalBookingId: "gcal-evt-new",
  startAt: input.startAt,
  endAt: new Date(Date.parse(input.startAt) + input.durationMin * 60_000).toISOString(),
  meetingUrl: null,
}));
const cancelBooking = vi.fn(async (..._a: unknown[]) => {});
const moveBooking = vi.fn(async (..._a: unknown[]) => {});
const busyBetween = vi.fn(async () => [] as Array<{ start: string; end: string }>);
let provider: Record<string, unknown> = {};

const reserveAppointment = vi.fn(async (_clientId: string, values: Record<string, unknown>) => ({
  id: "appt-new",
  ...values,
  status: "booked",
}));
const cancelAppointment = vi.fn(async (_c: string, id: string) => ({ ...OLD, id, status: "cancelled" }));
const dbSets: Array<Record<string, unknown>> = [];
const notifyOwnerCancellation = vi.fn(async (..._a: unknown[]) => {});

vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/agent-tools-auth", () => ({
  authorizeAgentTool: async () => ({
    ok: true,
    client: CLIENT,
    channel,
    retellCallId: null,
    call: { fromNumber: "+14155550100" },
    args,
  }),
}));
vi.mock("@/lib/data/calls", () => ({ getCallByRetellId: async () => null }));
vi.mock("@/lib/data/appointments", () => ({
  hasOverlappingAppointment: async () => false,
  reserveAppointment: (c: string, v: Record<string, unknown>) => reserveAppointment(c, v),
  findUpcomingAppointmentsByPhone: async () => upcoming,
  cancelAppointment: (c: string, id: string) => cancelAppointment(c, id),
}));
vi.mock("@/lib/data/providers", () => ({ findFreeProvider: async () => null }));
vi.mock("@/lib/data/availability-blocks", () => ({ listActiveBlocks: async () => [] }));
vi.mock("@/lib/booking", async (orig) => ({
  ...(await orig<typeof import("@/lib/booking")>()),
  getBookingProviderForClient: () => provider,
}));
vi.mock("@/lib/agents/waitlist-backfill", () => ({ offerFreedSlot: vi.fn(async () => {}) }));
vi.mock("@/lib/notify", () => ({
  notifyOwnerBooking: vi.fn(async () => {}),
  notifyOwnerCancellation: (...a: unknown[]) => notifyOwnerCancellation(...a),
}));
vi.mock("@/lib/appointment-texts", () => ({ sendBookingConfirmation: vi.fn() }));
vi.mock("@/lib/data/sms-consents", () => ({ recordSmsConsent: vi.fn() }));
vi.mock("@/lib/data/customer-languages", () => ({ rememberCustomerLanguage: vi.fn() }));
vi.mock("@/lib/data/chat-limits", () => ({ allowChatSms: async () => true }));
vi.mock("@/lib/webhooks-emit", () => ({ emitWebhook: vi.fn() }));
vi.mock("@/lib/deposit-request", () => ({ requestDeposit: vi.fn() }));
vi.mock("@/db", () => ({
  db: {
    update: () => ({
      set: (v: Record<string, unknown>) => ({ where: async () => void dbSets.push(v) }),
    }),
  },
}));
vi.mock("@/lib/env", () => ({
  env: { APP_URL: "https://app.test" },
  integrations: { google: () => true, microsoft: () => true, calcom: () => false },
}));

const { POST } = await import("./route");
const call = async () =>
  (await POST(new Request("https://app.test/api/agent-tools/book", { method: "POST" }))).json();

// New time: 2031-03-04 15:00 New York = 20:00Z.
const NEW_START = "2031-03-04T20:00:00.000Z";

beforeEach(() => {
  channel = "sms";
  upcoming = [OLD];
  args = { datetime: "2031-03-04T15:00:00", service: "Cleaning", reschedule_from: "2031-03-03T10:00:00" };
  provider = { name: "google-calendar", isConfigured: () => true, busyBetween, createBooking, cancelBooking, moveBooking };
  dbSets.length = 0;
  for (const f of [createBooking, cancelBooking, moveBooking, busyBetween, reserveAppointment, cancelAppointment, notifyOwnerCancellation]) f.mockClear();
});

describe("book tool reschedule_from (AI text replies)", () => {
  it("moves the existing calendar event in place and releases the old time", async () => {
    const body = await call();
    expect(body.success).toBe(true);
    expect(body.message).toMatch(/do NOT call cancel_appointment/);
    // No second event: the old one is moved.
    expect(createBooking).not.toHaveBeenCalled();
    expect(moveBooking).toHaveBeenCalledWith("gcal-evt-old", {
      startAt: NEW_START,
      durationMin: 60,
      timezone: "America/New_York",
    });
    // The new row is reserved without an event, then gets the moved event id;
    // the old row's id is cleared so cancelling it can't delete the moved event.
    expect(reserveAppointment.mock.calls[0][1]).toMatchObject({ externalBookingId: null, customerName: "Pat" });
    expect(dbSets).toEqual([
      { externalBookingId: "gcal-evt-old", meetingUrl: null },
      { externalBookingId: null },
    ]);
    expect(cancelBooking).not.toHaveBeenCalled();
    expect(cancelAppointment).toHaveBeenCalledWith(CLIENT.id, "appt-old");
    expect(notifyOwnerCancellation).toHaveBeenCalledWith(CLIENT, expect.objectContaining({ id: "appt-old" }), "text");
  });

  it("a failed move falls back to a new event + deleting the old one, and still books", async () => {
    moveBooking.mockRejectedValueOnce(new Error("Google event patch failed: 500"));
    const body = await call();
    expect(body.success).toBe(true);
    expect(createBooking).toHaveBeenCalledWith(expect.objectContaining({ startAt: NEW_START }));
    expect(cancelBooking).toHaveBeenCalledWith("gcal-evt-old", expect.any(String));
    expect(cancelAppointment).toHaveBeenCalledWith(CLIENT.id, "appt-old");
  });

  it("when the calendar is down entirely, the move still happens locally", async () => {
    moveBooking.mockRejectedValueOnce(new Error("down"));
    createBooking.mockRejectedValueOnce(new Error("down"));
    cancelBooking.mockRejectedValueOnce(new Error("down"));
    const body = await call();
    expect(body.success).toBe(true);
    expect(cancelAppointment).toHaveBeenCalledWith(CLIENT.id, "appt-old");
  });

  it("an old appointment with no event (e.g. Cal.com or never synced) books normally, then releases the old one", async () => {
    upcoming = [{ ...OLD, externalBookingId: null as unknown as string }];
    const body = await call();
    expect(body.success).toBe(true);
    expect(moveBooking).not.toHaveBeenCalled();
    expect(createBooking).toHaveBeenCalledTimes(1);
    expect(reserveAppointment.mock.calls[0][1]).toMatchObject({ externalBookingId: "gcal-evt-new" });
    expect(cancelAppointment).toHaveBeenCalledWith(CLIENT.id, "appt-old");
  });

  it("a provider that can't move (Cal.com) creates the new booking and cancels the old one there", async () => {
    provider = { name: "cal.com", isConfigured: () => true, createBooking, cancelBooking };
    const body = await call();
    expect(body.success).toBe(true);
    expect(createBooking).toHaveBeenCalledTimes(1);
    expect(cancelBooking).toHaveBeenCalledWith("gcal-evt-old");
  });

  it("refuses when the texting number has no matching appointment — nothing is written", async () => {
    upcoming = [];
    const body = await call();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/nothing to move/);
    expect(reserveAppointment).not.toHaveBeenCalled();
    expect(moveBooking).not.toHaveBeenCalled();
  });

  it("only works by text (caller-ID verified); web chat is told to book + cancel", async () => {
    channel = "web_chat";
    args = { ...args, phone: "415-555-0100" };
    const body = await call();
    expect(body.success).toBe(false);
    expect(reserveAppointment).not.toHaveBeenCalled();
  });

  it("losing the local race leaves the old event and appointment untouched", async () => {
    reserveAppointment.mockResolvedValueOnce(null as never);
    const body = await call();
    expect(body.success).toBe(false);
    expect(moveBooking).not.toHaveBeenCalled();
    expect(cancelBooking).not.toHaveBeenCalled();
    expect(cancelAppointment).not.toHaveBeenCalled();
  });
});
