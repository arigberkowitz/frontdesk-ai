import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Calendar sync gaps (2026-10-07): extra "counts as busy" calendars for Google
 * (freeBusy, multiple ids) and Microsoft (per-calendar calendarView), the
 * Outlook calendar list, and moving an event in place on reschedule. Raw REST
 * with fetch stubbed — no provider is ever called.
 */

vi.mock("@/lib/env", () => ({
  env: {
    APP_URL: "https://app.test",
    GOOGLE_CLIENT_ID: "gid",
    GOOGLE_CLIENT_SECRET: "gsecret",
    MS_CLIENT_ID: "mid",
    MS_CLIENT_SECRET: "msecret",
    CREDENTIALS_SECRET: "test-credentials-secret",
  },
  integrations: { google: () => true, microsoft: () => true, calcom: () => false },
}));
const warn = vi.fn();
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: (...a: unknown[]) => warn(...a), error: vi.fn() } }));
vi.mock("@/db", () => ({
  db: { update: () => ({ set: () => ({ where: async () => undefined }) }) },
}));

const { getBookingProviderForClient, eventDescription, isOwnCalendarProvider } = await import("./booking");
const { encryptSecret } = await import("./crypto");
const { msListCalendars } = await import("./microsoft-calendar");

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  warn.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const google = (busyIds: string[] | null = null) =>
  getBookingProviderForClient({
    id: "c1",
    calendarProvider: "google",
    calendarSecret: encryptSecret("refresh-1"),
    calendarId: "primary",
    calendarBusyIds: busyIds,
  });
const microsoft = (busyIds: string[] | null = null) =>
  getBookingProviderForClient({
    id: "c1",
    calendarProvider: "microsoft",
    calendarSecret: encryptSecret("refresh-1"),
    calendarBusyIds: busyIds,
  });

const S = "2031-03-04T20:00:00.000Z";
const E = "2031-03-04T21:00:00.000Z";

describe("Google: extra busy calendars via one freeBusy call", () => {
  it("asks for the booking calendar plus every extra id, and unions the busy times", async () => {
    fetchMock.mockResolvedValueOnce(json({ access_token: "at" })).mockResolvedValueOnce(
      json({
        calendars: {
          primary: { busy: [{ start: "2031-03-04T18:00:00Z", end: "2031-03-04T19:00:00Z" }] },
          "family@group.calendar.google.com": { busy: [{ start: "2031-03-04T20:30:00Z", end: "2031-03-04T21:30:00Z" }] },
        },
      }),
    );
    const busy = await google(["family@group.calendar.google.com"]).busyBetween!(S, E);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).items).toEqual([
      { id: "primary" },
      { id: "family@group.calendar.google.com" },
    ]);
    expect(busy).toHaveLength(2);
  });

  it("no picks = exactly today's request (primary only)", async () => {
    fetchMock.mockResolvedValueOnce(json({ access_token: "at" })).mockResolvedValueOnce(json({ calendars: { primary: { busy: [] } } }));
    await google(null).busyBetween!(S, E);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).items).toEqual([{ id: "primary" }]);
  });

  it("an extra calendar Google can't see is skipped with a warning, never blocking", async () => {
    fetchMock.mockResolvedValueOnce(json({ access_token: "at" })).mockResolvedValueOnce(
      json({
        calendars: {
          primary: { busy: [] },
          "gone@group.calendar.google.com": { errors: [{ domain: "global", reason: "notFound" }] },
        },
      }),
    );
    const busy = await google(["gone@group.calendar.google.com"]).busyBetween!(S, E);
    expect(busy).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      "booking.busy_calendar_skipped",
      expect.objectContaining({ calendarId: "gone@group.calendar.google.com", reason: "notFound" }),
    );
  });

  it("the booking calendar itself erroring is still a real failure", async () => {
    fetchMock.mockResolvedValueOnce(json({ access_token: "at" })).mockResolvedValueOnce(
      json({ calendars: { primary: { errors: [{ reason: "backendError" }] } } }),
    );
    await expect(google().busyBetween!(S, E)).rejects.toThrow(/booking calendar/);
  });

  it("availability subtracts busy time from the extra calendars too", async () => {
    fetchMock.mockResolvedValueOnce(json({ access_token: "at" })).mockResolvedValueOnce(
      json({
        calendars: {
          primary: { busy: [] },
          "kids@group.calendar.google.com": { busy: [{ start: "2031-03-04T14:00:00Z", end: "2031-03-04T22:00:00Z" }] },
        },
      }),
    );
    const slots = await google(["kids@group.calendar.google.com"]).getAvailability({
      durationMin: 60,
      rangeStart: "2031-03-04T05:00:00.000Z",
      rangeEnd: "2031-03-05T05:00:00.000Z",
      timezone: "America/New_York",
      businessHours: [{ dayOfWeek: 2, isClosed: false, openTime: "09:00", closeTime: "17:00" }],
    });
    // 9–5 New York = 14:00–22:00Z, all busy on the kids' calendar.
    expect(slots).toEqual([]);
  });
});

describe("Microsoft: calendar list + extra busy calendars", () => {
  it("lists the mailbox's calendars with the scope we already hold", async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        value: [
          { id: "AAA", name: "Calendar", isDefaultCalendar: true, owner: { address: "owner@biz.test" } },
          { id: "BBB", name: "Family", isDefaultCalendar: false, owner: { address: "owner@biz.test" } },
        ],
      }),
    );
    const list = await msListCalendars("ms-at");
    expect(String(fetchMock.mock.calls[0][0])).toContain("https://graph.microsoft.com/v1.0/me/calendars?");
    expect(list).toEqual([
      { id: "AAA", name: "Calendar", isDefault: true, owner: "owner@biz.test" },
      { id: "BBB", name: "Family", isDefault: false, owner: "owner@biz.test" },
    ]);
  });

  it("reads the default calendarView plus each extra calendar's calendarView", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ access_token: "ms-at" }))
      .mockResolvedValueOnce(json({ value: [] }))
      .mockResolvedValueOnce(
        json({ value: [{ start: { dateTime: "2031-03-04T20:30:00.0000000" }, end: { dateTime: "2031-03-04T21:30:00.0000000" }, showAs: "busy" }] }),
      );
    const busy = await microsoft(["BBB"]).busyBetween!(S, E);
    expect(String(fetchMock.mock.calls[1][0])).toContain("/me/calendarView?");
    expect(String(fetchMock.mock.calls[2][0])).toContain("/me/calendars/BBB/calendarView?");
    expect(busy).toEqual([{ start: "2031-03-04T20:30:00.0000000Z", end: "2031-03-04T21:30:00.0000000Z" }]);
  });

  it("an extra calendar that fails is skipped with a warning", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ access_token: "ms-at" }))
      .mockResolvedValueOnce(json({ value: [] }))
      .mockResolvedValueOnce(json({ error: "ErrorItemNotFound" }, 404));
    const busy = await microsoft(["GONE"]).busyBetween!(S, E);
    expect(busy).toEqual([]);
    expect(warn).toHaveBeenCalledWith("booking.busy_calendar_skipped", expect.objectContaining({ calendarId: "GONE" }));
  });
});

describe("moveBooking: reschedule keeps the same event", () => {
  it("Google PATCHes the event's start/end on the booking calendar", async () => {
    fetchMock.mockResolvedValueOnce(json({ access_token: "at" })).mockResolvedValueOnce(json({ id: "evt-1" }));
    await google().moveBooking!("evt-1", { startAt: S, durationMin: 45, timezone: "America/New_York" });
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("https://www.googleapis.com/calendar/v3/calendars/primary/events/evt-1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({
      start: { dateTime: S, timeZone: "America/New_York" },
      end: { dateTime: "2031-03-04T20:45:00.000Z", timeZone: "America/New_York" },
    });
  });

  it("Microsoft PATCHes /me/events/{id}", async () => {
    fetchMock.mockResolvedValueOnce(json({ access_token: "ms-at" })).mockResolvedValueOnce(json({ id: "AQ==" }));
    await microsoft().moveBooking!("AQ==", { startAt: S, durationMin: 60, timezone: "America/New_York" });
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("https://graph.microsoft.com/v1.0/me/events/AQ%3D%3D");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body).end).toEqual({ dateTime: E, timeZone: "UTC" });
  });

  it("a failed PATCH throws so the caller can fall back", async () => {
    fetchMock.mockResolvedValueOnce(json({ access_token: "at" })).mockResolvedValueOnce(json({}, 404));
    await expect(google().moveBooking!("evt-1", { startAt: S, durationMin: 30, timezone: "UTC" })).rejects.toThrow(/patch failed/);
  });
});

describe("event description + provider kind", () => {
  it("says who made the booking", () => {
    expect(eventDescription({ customerPhone: "+1415", source: "manual" })).toBe("Added in FrontDesk AI. Phone: +1415.");
    expect(eventDescription({ customerPhone: "" })).toBe("Booked by your AI receptionist.");
  });
  it("only Google / Outlook count as the owner's own calendar (not Cal.com)", () => {
    expect(isOwnCalendarProvider(google())).toBe(true);
    expect(isOwnCalendarProvider(microsoft())).toBe(true);
    expect(
      isOwnCalendarProvider(getBookingProviderForClient({ id: "c1", calendarProvider: "calcom", calendarSecret: encryptSecret("k"), calendarId: "1" })),
    ).toBe(false);
  });
});
