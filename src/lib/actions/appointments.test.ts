import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Portal appointments × the owner's calendar (calendar sync gap 2):
 * hand-entered appointments are pushed to Google / Outlook on create, a
 * calendar failure never blocks the booking, and portal cancels delete the
 * event. Every provider call is a mock.
 */

const CLIENT = {
  id: "c1",
  name: "Acme",
  industry: null,
  timezone: "America/New_York",
  services: [{ id: "svc-1", name: "Cleaning", durationMin: 60, isActive: true, virtualOk: true }],
};

const createBooking = vi.fn(async (..._a: unknown[]) => ({
  externalBookingId: "evt-manual",
  startAt: "",
  endAt: "",
  meetingUrl: "https://meet.google.com/abc",
}));
const cancelBooking = vi.fn(async (..._a: unknown[]) => {});
let provider: Record<string, unknown> = {};
const createAppointment = vi.fn(async (_c: string, v: Record<string, unknown>) => ({ id: "appt-1", ...v }));
const cancelAppointment = vi.fn(async (..._a: unknown[]) => ({
  id: "appt-1",
  startAt: new Date("2031-03-04T20:00:00Z"),
  endAt: new Date("2031-03-04T21:00:00Z"),
  serviceId: "svc-1",
  externalBookingId: "evt-1" as string | null,
}));
const dbSets: Array<Record<string, unknown>> = [];

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/auth-guard", () => ({
  assertClientAccess: async () => ({ id: "u1", orgId: "org1" }),
  requireClientEditor: async () => ({ ok: true, user: { id: "u1", orgId: "org1" } }),
}));
vi.mock("@/lib/data/clients", () => ({
  assertClientInOrg: async () => CLIENT,
  getClientByIdUnsafe: async () => CLIENT,
}));
vi.mock("@/lib/data/appointments", () => ({
  createAppointment: (c: string, v: Record<string, unknown>) => createAppointment(c, v),
  cancelAppointment: (...a: unknown[]) => cancelAppointment(...a),
  hasOverlappingAppointment: async () => false,
}));
vi.mock("@/lib/data/providers", () => ({ isProviderFree: async () => true, listProviders: async () => [] }));
vi.mock("@/lib/data/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/data/reminders", () => ({ getClientAppointment: vi.fn() }));
vi.mock("@/lib/webhooks-emit", () => ({ emitWebhook: vi.fn(async () => {}) }));
vi.mock("@/lib/agents/waitlist-backfill", () => ({ offerFreedSlot: vi.fn(async () => 0) }));
vi.mock("@/lib/booking", async (orig) => ({
  ...(await orig<typeof import("@/lib/booking")>()),
  getBookingProviderForClient: () => provider,
}));
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

const { createManualAppointmentAction, cancelAppointmentAction } = await import("./appointments");
const prev = { ok: false } as never;

function addForm(): FormData {
  const f = new FormData();
  f.set("clientId", "c1");
  f.set("customerName", "Pat");
  f.set("customerPhone", "+14155550100");
  f.set("serviceId", "svc-1");
  f.set("date", "2031-03-04");
  f.set("time", "15:00");
  return f;
}
function cancelForm(): FormData {
  const f = new FormData();
  f.set("clientId", "c1");
  f.set("appointmentId", "appt-1");
  return f;
}

beforeEach(() => {
  provider = { name: "google-calendar", isConfigured: () => true, createBooking, cancelBooking };
  dbSets.length = 0;
  for (const f of [createBooking, cancelBooking, createAppointment, cancelAppointment]) f.mockClear();
});

describe("createManualAppointmentAction → owner's calendar", () => {
  it("saves the appointment, then pushes it to Google and stores the event id", async () => {
    const r = await createManualAppointmentAction(prev, addForm());
    expect(r).toMatchObject({ ok: true, message: expect.stringMatching(/put on your calendar/) });
    expect(createAppointment).toHaveBeenCalledTimes(1);
    expect(createBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        startAt: "2031-03-04T20:00:00.000Z", // 3 PM New York
        durationMin: 60,
        customerName: "Pat",
        customerPhone: "+14155550100",
        timezone: "America/New_York",
        virtual: true,
        source: "manual",
      }),
    );
    expect(dbSets).toEqual([{ externalBookingId: "evt-manual", meetingUrl: "https://meet.google.com/abc" }]);
  });

  it("Outlook too", async () => {
    provider = { ...provider, name: "microsoft-calendar" };
    await createManualAppointmentAction(prev, addForm());
    expect(createBooking).toHaveBeenCalledTimes(1);
  });

  it("a calendar failure never blocks the booking — the owner is told to add it themselves", async () => {
    createBooking.mockRejectedValueOnce(new Error("Google event insert failed: 401"));
    const r = await createManualAppointmentAction(prev, addForm());
    expect(r).toMatchObject({ ok: true, message: expect.stringMatching(/couldn't add it to your calendar/) });
    expect(createAppointment).toHaveBeenCalledTimes(1);
    expect(dbSets).toEqual([]);
  });

  it("Cal.com and no-calendar businesses are left alone (no fake-attendee bookings)", async () => {
    provider = { name: "cal.com", isConfigured: () => true, createBooking, cancelBooking };
    let r = await createManualAppointmentAction(prev, addForm());
    expect(createBooking).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, message: "Appointment added." });
    provider = { name: "none", isConfigured: () => false, createBooking, cancelBooking };
    r = await createManualAppointmentAction(prev, addForm());
    expect(createBooking).not.toHaveBeenCalled();
    expect(r.ok).toBe(true);
  });

  it("a provider that throws while resolving still saves the booking", async () => {
    provider = {
      name: "google-calendar",
      isConfigured: () => {
        throw new Error("decrypt failed");
      },
    };
    const r = await createManualAppointmentAction(prev, addForm());
    expect(r.ok).toBe(true);
    expect(createAppointment).toHaveBeenCalledTimes(1);
  });
});

describe("cancelAppointmentAction → deletes the event", () => {
  it("deletes the calendar event of a cancelled appointment", async () => {
    const r = await cancelAppointmentAction(prev, cancelForm());
    expect(cancelBooking).toHaveBeenCalledWith("evt-1", expect.any(String));
    expect(r).toMatchObject({ ok: true, message: expect.stringMatching(/slot is open again/) });
  });

  it("says so when the event couldn't be removed", async () => {
    cancelBooking.mockRejectedValueOnce(new Error("down"));
    const r = await cancelAppointmentAction(prev, cancelForm());
    expect(r).toMatchObject({ ok: true, message: expect.stringMatching(/couldn't remove it from your calendar/) });
  });

  it("a hand-entered appointment pushed earlier is deleted the same way (it has an event id now)", async () => {
    cancelAppointment.mockResolvedValueOnce({
      id: "appt-1",
      startAt: new Date("2031-03-04T20:00:00Z"),
      endAt: new Date("2031-03-04T21:00:00Z"),
      serviceId: "svc-1",
      externalBookingId: "evt-manual",
    });
    await cancelAppointmentAction(prev, cancelForm());
    expect(cancelBooking).toHaveBeenCalledWith("evt-manual", expect.any(String));
  });
});
