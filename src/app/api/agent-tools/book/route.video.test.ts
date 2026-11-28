import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Video (and phone / in-person) appointments through the book tool: which link
 * is made, who gets the invite, what the agent is told to say, and what
 * happens when a link can't be made. Every provider is mocked.
 */

type Svc = { id: string; name: string; durationMin: number; isActive: boolean; locationType: string; videoProvider: string | null; virtualOk: boolean };
const svc = (over: Partial<Svc>): Svc => ({
  id: "svc-1",
  name: "Consult",
  durationMin: 30,
  isActive: true,
  locationType: "video",
  videoProvider: "meet",
  virtualOk: true,
  ...over,
});

let service: Svc = svc({});
let channel = "voice";
let zoomSecret: string | null = null;
const CLIENT = () => ({
  id: "11111111-1111-4111-8111-111111111111",
  name: "Acme Law",
  timezone: "America/New_York",
  industry: "Law firm",
  address: "12 Main St, Suite 4, Springfield, IL",
  businessHours: [],
  staffModeEnabled: false,
  calendarProvider: "google",
  zoomSecret,
  services: [service],
});

let args: Record<string, unknown> = {};
const afterTasks: Array<() => unknown> = [];
let meetingUrl: string | null = "https://meet.google.com/abc-defg-hij";
const createBooking = vi.fn(async (input: { startAt: string; durationMin: number; meetingUrl?: string | null; virtual?: boolean }) => ({
  externalBookingId: "gcal-1",
  startAt: input.startAt,
  endAt: new Date(Date.parse(input.startAt) + input.durationMin * 60_000).toISOString(),
  // Like the real provider: a Meet link only when one was asked for.
  meetingUrl: input.meetingUrl ?? (input.virtual ? meetingUrl : null),
}));
const cancelBooking = vi.fn(async (..._a: unknown[]) => {});
const provider = () => ({
  name: "google-calendar",
  isConfigured: () => true,
  busyBetween: async () => [],
  createBooking,
  cancelBooking,
});
const reserveAppointment = vi.fn(async (_c: string, v: Record<string, unknown>) => ({ id: "appt-1", status: "booked", ...v }));
const notifyVideoFailed = vi.fn(async (..._a: unknown[]) => {});
const sendBookingConfirmation = vi.fn(async (..._a: unknown[]) => {});
const createZoomMeeting = vi.fn(async (..._a: unknown[]) => ({ id: "98765", joinUrl: "https://zoom.us/j/98765?pwd=x" }));
const deleteZoomMeeting = vi.fn(async (..._a: unknown[]) => {});
let consent = true;

vi.mock("next/server", () => ({ after: (fn: () => unknown) => afterTasks.push(fn) }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/agent-tools-auth", () => ({
  authorizeAgentTool: async () => ({ ok: true, client: CLIENT(), channel, retellCallId: null, call: { fromNumber: "+14155550100" }, args }),
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
  getBookingProviderForClient: () => provider(),
}));
vi.mock("@/lib/notify", () => ({
  notifyOwnerBooking: vi.fn(async () => {}),
  notifyOwnerCancellation: vi.fn(async () => {}),
  notifyOwnerVideoLinkFailed: (...a: unknown[]) => notifyVideoFailed(...a),
}));
vi.mock("@/lib/appointment-texts", () => ({ sendBookingConfirmation: (...a: unknown[]) => sendBookingConfirmation(...a) }));
vi.mock("@/lib/data/sms-consents", () => ({ recordSmsConsent: vi.fn() }));
vi.mock("@/lib/data/customer-languages", () => ({ rememberCustomerLanguage: vi.fn() }));
vi.mock("@/lib/data/chat-limits", () => ({ allowChatSms: async () => true }));
vi.mock("@/lib/webhooks-emit", () => ({ emitWebhook: vi.fn() }));
vi.mock("@/lib/deposit-request", () => ({ requestDeposit: vi.fn() }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/zoom", () => ({
  zoomConnected: (c: { zoomSecret?: string | null }) => Boolean(c.zoomSecret),
  zoomConfigured: () => true,
  createZoomMeeting: (...a: unknown[]) => createZoomMeeting(...a),
  deleteZoomMeeting: (...a: unknown[]) => deleteZoomMeeting(...a),
  updateZoomMeetingTime: vi.fn(),
  ZoomAuthError: class ZoomAuthError extends Error {},
}));
vi.mock("@/lib/env", () => ({
  env: { APP_URL: "https://app.test" },
  integrations: { google: () => true, microsoft: () => true, calcom: () => false, zoom: () => true },
}));

const { POST } = await import("./route");
const call = async () =>
  (await POST(new Request("https://app.test/api/agent-tools/book", { method: "POST" }))).json();
const flush = async () => {
  for (const t of afterTasks.splice(0)) await t();
};

beforeEach(() => {
  service = svc({});
  channel = "voice";
  zoomSecret = null;
  consent = true;
  meetingUrl = "https://meet.google.com/abc-defg-hij";
  args = {
    datetime: "2031-03-04T15:00:00",
    service: "Consult",
    name: "Pat",
    phone: "415-555-0100",
    email: "pat@example.com",
    sms_consent: consent,
  };
  afterTasks.length = 0;
  for (const f of [createBooking, cancelBooking, reserveAppointment, notifyVideoFailed, sendBookingConfirmation, createZoomMeeting, deleteZoomMeeting]) f.mockClear();
});

describe("video appointment, Google Meet", () => {
  it("asks the calendar for a Meet link and invites the caller's email", async () => {
    const body = await call();
    expect(body.success).toBe(true);
    expect(createBooking).toHaveBeenCalledWith(
      expect.objectContaining({ virtual: true, locationType: "video", customerEmail: "pat@example.com", inviteCustomer: true }),
    );
    expect(reserveAppointment.mock.calls[0][1]).toMatchObject({ meetingUrl: "https://meet.google.com/abc-defg-hij", customerEmail: "pat@example.com" });
    // The agent is told the truth about what was sent.
    expect(body.message).toMatch(/I've sent you a video link/);
    expect(body.message).toMatch(/Le envié un enlace de video/);
    expect(body.message).not.toContain("meet.google.com");
    expect(notifyVideoFailed).not.toHaveBeenCalled();
  });

  it("no email and no text consent: the link did not reach them, so the agent must not say it did", async () => {
    args = { ...args, email: undefined, sms_consent: false };
    const body = await call();
    expect(body.success).toBe(true);
    expect(createBooking.mock.calls[0][0]).not.toHaveProperty("inviteCustomer");
    expect(body.message).toMatch(/has NOT reached them/);
    expect(body.message).not.toMatch(/I've sent you/);
  });

  it("no email but they agreed to texts: the confirmation text carries the link", async () => {
    args = { ...args, email: undefined, sms_consent: true };
    const body = await call();
    expect(body.message).toMatch(/by text/);
    await flush();
    expect(sendBookingConfirmation).toHaveBeenCalled();
  });

  it("web chat: no invite to a typed email (an anonymous visitor could aim it at anyone); the link goes in the reply", async () => {
    channel = "web_chat";
    const body = await call();
    expect(createBooking.mock.calls[0][0]).not.toHaveProperty("inviteCustomer");
    expect(body.message).toContain("https://meet.google.com/abc-defg-hij");
  });

  it("the calendar made no link: still booked, owner alerted, agent told not to promise one", async () => {
    meetingUrl = null;
    const body = await call();
    expect(body.success).toBe(true);
    expect(body.message).toMatch(/could not be created/);
    expect(body.message).toMatch(/Do NOT say a link was sent/);
    await flush();
    expect(notifyVideoFailed).toHaveBeenCalledTimes(1);
    expect(notifyVideoFailed.mock.calls[0][2]).toMatchObject({ reason: "no_link" });
  });
});

describe("video appointment, Zoom", () => {
  beforeEach(() => {
    service = svc({ videoProvider: "zoom" });
    zoomSecret = "enc";
  });

  it("creates the Zoom meeting, puts the join link on the event, and remembers the meeting id", async () => {
    const body = await call();
    expect(body.success).toBe(true);
    expect(createZoomMeeting).toHaveBeenCalledTimes(1);
    expect(createBooking).toHaveBeenCalledWith(
      expect.objectContaining({ meetingUrl: "https://zoom.us/j/98765?pwd=x", locationType: "video" }),
    );
    expect(createBooking.mock.calls[0][0]).not.toHaveProperty("virtual");
    expect(reserveAppointment.mock.calls[0][1]).toMatchObject({
      meetingUrl: "https://zoom.us/j/98765?pwd=x",
      zoomMeetingId: "98765",
    });
    expect(body.message).toMatch(/Zoom/);
    expect(body.message).toMatch(/I've sent you a video link/);
  });

  it("Zoom not connected: books anyway with no link, alerts the owner", async () => {
    zoomSecret = null;
    const body = await call();
    expect(body.success).toBe(true);
    expect(createZoomMeeting).not.toHaveBeenCalled();
    expect(body.message).toMatch(/Do NOT say a link was sent/);
    await flush();
    expect(notifyVideoFailed.mock.calls[0][2]).toMatchObject({ reason: "zoom_not_connected" });
  });

  it("Zoom errors: books anyway, alerts the owner", async () => {
    createZoomMeeting.mockRejectedValueOnce(new Error("Zoom create meeting failed: 500"));
    const body = await call();
    expect(body.success).toBe(true);
    await flush();
    expect(notifyVideoFailed.mock.calls[0][2]).toMatchObject({ reason: "zoom_error" });
  });

  it("the calendar event fails after the Zoom meeting was made: the Zoom meeting is deleted", async () => {
    createBooking.mockRejectedValueOnce(new Error("Google event insert failed: 500"));
    const body = await call();
    expect(body.success).toBe(false);
    expect(deleteZoomMeeting).toHaveBeenCalledWith(expect.anything(), "98765");
  });

  it("losing the local race deletes both the event and the Zoom meeting", async () => {
    reserveAppointment.mockResolvedValueOnce(null as never);
    const body = await call();
    expect(body.success).toBe(false);
    expect(cancelBooking).toHaveBeenCalledWith("gcal-1");
    expect(deleteZoomMeeting).toHaveBeenCalledWith(expect.anything(), "98765");
  });
});

describe("phone and in-person appointments", () => {
  it("phone: no link, the event says to call, the agent says we'll call", async () => {
    service = svc({ locationType: "phone", videoProvider: null, virtualOk: false });
    const body = await call();
    expect(createBooking).toHaveBeenCalledWith(expect.objectContaining({ locationType: "phone" }));
    expect(createBooking.mock.calls[0][0]).not.toHaveProperty("virtual");
    expect(createBooking.mock.calls[0][0]).not.toHaveProperty("inviteCustomer");
    expect(body.message).toMatch(/phone appointment/);
    expect(notifyVideoFailed).not.toHaveBeenCalled();
  });

  it("in person: the calendar event location is the business address", async () => {
    service = svc({ locationType: "in_person", videoProvider: null, virtualOk: false });
    await call();
    expect(createBooking).toHaveBeenCalledWith(
      expect.objectContaining({ locationType: "in_person", locationText: "12 Main St, Suite 4, Springfield, IL" }),
    );
    expect(notifyVideoFailed).not.toHaveBeenCalled();
  });

  it("a job at the customer's place does not get the business address as its location", async () => {
    service = svc({ locationType: "in_person", videoProvider: null, virtualOk: false });
    args = { ...args, service_address: "99 Oak Ave, Springfield" };
    await call();
    expect(createBooking.mock.calls[0][0]).not.toHaveProperty("locationText");
  });

  it("a row from before location types (virtualOk only) still books a Meet link", async () => {
    service = { ...svc({}), locationType: undefined as unknown as string, videoProvider: null, virtualOk: true };
    await call();
    expect(createBooking).toHaveBeenCalledWith(expect.objectContaining({ virtual: true, locationType: "video" }));
  });
});
