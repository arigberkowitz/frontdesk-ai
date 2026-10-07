import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cancels delete the calendar event on every agent path — voice and AI text
 * replies — and a calendar failure never stops the cancel. Provider mocked.
 */

const CLIENT = { id: "11111111-1111-4111-8111-111111111111", name: "Acme", timezone: "America/New_York" };
const APPT = {
  id: "appt-1",
  customerPhone: "+14155550100",
  customerName: "Pat",
  startAt: new Date(Date.now() + 86_400_000),
  endAt: new Date(Date.now() + 90_000_000),
  serviceId: null,
  externalBookingId: "evt-1",
  service: { name: "Cleaning" },
};

let authResult: Record<string, unknown>;
const cancelled: string[] = [];
const cancelBooking = vi.fn(async (..._a: unknown[]) => {});

vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: { AGENT_TOOLS_SECRET: "s" }, integrations: { twilio: () => true } }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/agent-tools-auth", () => ({ authorizeAgentTool: async () => authResult }));
vi.mock("@/lib/data/calls", () => ({ getCallByRetellId: async () => null }));
vi.mock("@/lib/data/appointments", () => ({
  findUpcomingAppointmentsByPhone: async () => [APPT],
  cancelAppointment: async (_c: string, id: string) => {
    cancelled.push(id);
    return APPT;
  },
}));
vi.mock("@/lib/booking", () => ({
  getBookingProviderForClient: () => ({ name: "google-calendar", isConfigured: () => true, cancelBooking }),
}));
vi.mock("@/lib/notify", () => ({ notifyOwnerCancellation: vi.fn() }));
vi.mock("@/lib/agents/waitlist-backfill", () => ({ offerFreedSlot: vi.fn() }));
vi.mock("@/lib/data/sms-optouts", () => ({
  isOptedOut: async () => false,
  normalizePhone: (raw: string) => {
    const d = raw.replace(/[^\d]/g, "");
    return d.length === 10 ? `1${d}` : d;
  },
}));
vi.mock("@/lib/data/chat-limits", () => ({ allowChatSms: async () => true }));
vi.mock("@/lib/notifier", () => ({ notifier: { sendSms: async () => ({ ok: true }) } }));

const { POST } = await import("./route");
const req = () => new Request("https://app.test/api/agent-tools/cancel", { method: "POST" });

beforeEach(() => {
  cancelled.length = 0;
  cancelBooking.mockReset();
});

describe("cancel tool × connected calendar", () => {
  for (const channel of ["voice", "sms"] as const) {
    it(`${channel}: deletes the calendar event, then cancels locally`, async () => {
      authResult = { ok: true, client: CLIENT, channel, args: {}, call: { fromNumber: "+14155550100" } };
      const body = await (await POST(req())).json();
      expect(body.success).toBe(true);
      expect(cancelBooking).toHaveBeenCalledWith("evt-1", expect.any(String));
      expect(cancelled).toEqual(["appt-1"]);
    });
  }

  it("a calendar failure never stops the cancel", async () => {
    cancelBooking.mockRejectedValueOnce(new Error("Google event delete failed: 500"));
    authResult = { ok: true, client: CLIENT, channel: "sms", args: {}, call: { fromNumber: "+14155550100" } };
    const body = await (await POST(req())).json();
    expect(body.success).toBe(true);
    expect(cancelled).toEqual(["appt-1"]);
  });
});
