import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Google Meet / Outlook / Cal.com: what each provider sends when a video booking is created. Fetch is stubbed. */

vi.mock("@/lib/env", () => ({
  env: { APP_URL: "https://app.test", GOOGLE_CLIENT_ID: "gid", GOOGLE_CLIENT_SECRET: "gs", MS_CLIENT_ID: "m", MS_CLIENT_SECRET: "ms", CREDENTIALS_SECRET: "test-credentials-secret" },
  integrations: { google: () => true, microsoft: () => true, calcom: () => true },
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/db", () => ({ db: { update: () => ({ set: () => ({ where: async () => {} }) }) } }));

const { getBookingProviderForClient, eventDescription, eventLocation, eventGuest } = await import("./booking");
const { encryptSecret } = await import("./crypto");

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const base = {
  startAt: "2031-03-04T20:00:00.000Z",
  durationMin: 30,
  customerName: "Pat",
  customerPhone: "+14155550100",
  timezone: "America/New_York",
};
const google = () =>
  getBookingProviderForClient({ id: "c1", calendarProvider: "google", calendarSecret: encryptSecret("rt"), calendarId: "primary" });

describe("Google Calendar: Meet", () => {
  it("creates the event with a hangoutsMeet conferenceData request (conferenceDataVersion=1) — calendar.events scope only", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ access_token: "at" }))
      .mockResolvedValueOnce(json({ id: "evt-1", hangoutLink: "https://meet.google.com/abc-defg-hij" }));
    const r = await google().createBooking({ ...base, virtual: true, locationType: "video" });
    expect(r.meetingUrl).toBe("https://meet.google.com/abc-defg-hij");
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toContain("/calendars/primary/events?conferenceDataVersion=1");
    expect(url).not.toContain("sendUpdates");
    const body = JSON.parse(init.body);
    expect(body.conferenceData.createRequest.conferenceSolutionKey).toEqual({ type: "hangoutsMeet" });
    expect(body.conferenceData.createRequest.requestId).toBeTruthy();
    expect(body.attendees).toBeUndefined();
  });

  it("adds the caller as a guest and asks Google to email the invite", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ access_token: "at" }))
      .mockResolvedValueOnce(json({ id: "evt-1", hangoutLink: "https://meet.google.com/x" }));
    await google().createBooking({ ...base, virtual: true, locationType: "video", customerEmail: "pat@example.com", inviteCustomer: true });
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toContain("conferenceDataVersion=1");
    expect(url).toContain("sendUpdates=all");
    expect(JSON.parse(init.body).attendees).toEqual([{ email: "pat@example.com", displayName: "Pat" }]);
  });

  it("an email without the invite go-ahead is not added to the event", async () => {
    fetchMock.mockResolvedValueOnce(json({ access_token: "at" })).mockResolvedValueOnce(json({ id: "e", hangoutLink: "https://meet.google.com/x" }));
    await google().createBooking({ ...base, virtual: true, customerEmail: "pat@example.com" });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).attendees).toBeUndefined();
  });

  it("reads the link from conferenceData when hangoutLink is absent", async () => {
    fetchMock.mockResolvedValueOnce(json({ access_token: "at" })).mockResolvedValueOnce(
      json({ id: "e", conferenceData: { entryPoints: [{ entryPointType: "phone", uri: "tel:+1" }, { entryPointType: "video", uri: "https://meet.google.com/zzz" }] } }),
    );
    expect((await google().createBooking({ ...base, virtual: true })).meetingUrl).toBe("https://meet.google.com/zzz");
  });

  it("Google refuses the conference (Workspace turned Meet off): the event is still created, without a link", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ access_token: "at" }))
      .mockResolvedValueOnce(json({ error: { message: "Invalid conference type value." } }, 400))
      .mockResolvedValueOnce(json({ id: "evt-plain" }));
    const r = await google().createBooking({ ...base, virtual: true, customerEmail: "pat@example.com", inviteCustomer: true });
    expect(r).toMatchObject({ externalBookingId: "evt-plain", meetingUrl: null });
    const retry = fetchMock.mock.calls[2];
    expect(retry[0]).not.toContain("conferenceDataVersion");
    expect(JSON.parse(retry[1].body).conferenceData).toBeUndefined();
  });

  it("a non-400 failure still fails the booking (the calendar is really down)", async () => {
    fetchMock.mockResolvedValueOnce(json({ access_token: "at" })).mockResolvedValueOnce(json({}, 500));
    await expect(google().createBooking({ ...base, virtual: true })).rejects.toThrow(/insert failed: 500/);
  });

  it("a Zoom link goes in as the event location and description, with no Meet requested", async () => {
    fetchMock.mockResolvedValueOnce(json({ access_token: "at" })).mockResolvedValueOnce(json({ id: "evt-z" }));
    const r = await google().createBooking({ ...base, meetingUrl: "https://zoom.us/j/1?pwd=a", virtual: true, locationType: "video" });
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).not.toContain("conferenceDataVersion");
    const body = JSON.parse(init.body);
    expect(body.location).toBe("https://zoom.us/j/1?pwd=a");
    expect(body.description).toContain("https://zoom.us/j/1?pwd=a");
    expect(body.conferenceData).toBeUndefined();
    expect(r.meetingUrl).toBe("https://zoom.us/j/1?pwd=a");
  });

  it("phone and in-person set the event location", async () => {
    fetchMock.mockResolvedValueOnce(json({ access_token: "at" })).mockResolvedValueOnce(json({ id: "e1" }));
    await google().createBooking({ ...base, locationType: "phone" });
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.location).toBe("Phone call");
    expect(body.description).toMatch(/call the customer at \+14155550100/);
    fetchMock.mockResolvedValueOnce(json({ access_token: "at" })).mockResolvedValueOnce(json({ id: "e2" }));
    await google().createBooking({ ...base, locationType: "in_person", locationText: "12 Main St, Springfield" });
    expect(JSON.parse(fetchMock.mock.calls[3][1].body).location).toBe("12 Main St, Springfield");
  });
});

describe("event helpers", () => {
  it("description / location / guest rules", () => {
    expect(eventDescription({ customerPhone: "+1415", source: "ai" })).toBe("Booked by your AI receptionist. Phone: +1415.");
    expect(eventLocation({})).toBeUndefined();
    expect(eventGuest({ customerName: "Pat", customerEmail: "a@b.co", inviteCustomer: false })).toBeUndefined();
    expect(eventGuest({ customerName: "Pat", customerEmail: " ", inviteCustomer: true })).toBeUndefined();
    expect(eventGuest({ customerEmail: "a@b.co", customerName: "Pat", inviteCustomer: true })).toEqual({ email: "a@b.co", name: "Pat" });
  });
});

describe("Outlook: Teams, Zoom, invite", () => {
  const ms = () =>
    getBookingProviderForClient({ id: "c2", calendarProvider: "microsoft", calendarSecret: encryptSecret("mrt"), calendarId: null });

  it("Teams link and the customer as a required attendee", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ access_token: "mat", refresh_token: "mrt" }))
      .mockResolvedValueOnce(json({ id: "ms-1", onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/meetup-join/x" } }));
    const r = await ms().createBooking({ ...base, virtual: true, locationType: "video", customerEmail: "pat@example.com", inviteCustomer: true });
    expect(r.meetingUrl).toBe("https://teams.microsoft.com/l/meetup-join/x");
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.isOnlineMeeting).toBe(true);
    expect(body.attendees[0]).toMatchObject({ type: "required", emailAddress: { address: "pat@example.com", name: "Pat" } });
  });

  it("Zoom link: location + description, no Teams meeting", async () => {
    fetchMock.mockResolvedValueOnce(json({ access_token: "mat", refresh_token: "mrt" })).mockResolvedValueOnce(json({ id: "ms-2" }));
    const r = await ms().createBooking({ ...base, meetingUrl: "https://zoom.us/j/2", locationType: "video" });
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.isOnlineMeeting).toBeUndefined();
    expect(body.location).toEqual({ displayName: "https://zoom.us/j/2" });
    expect(r.meetingUrl).toBe("https://zoom.us/j/2");
  });
});

describe("Cal.com: built-in Meet / Zoom location", () => {
  const cal = () =>
    getBookingProviderForClient({ id: "c3", calendarProvider: "calcom", calendarSecret: encryptSecret("cal_key"), calendarId: "42" });
  const booking = (extra: Record<string, unknown> = {}) => ({
    data: { uid: "uid-1", start: base.startAt, end: "2031-03-04T20:30:00.000Z", ...extra },
  });

  it("asks for the google-meet integration location and returns the link Cal.com made", async () => {
    fetchMock.mockResolvedValueOnce(json(booking({ location: "https://meet.google.com/cal-meet" })));
    const r = await cal().createBooking({ ...base, locationType: "video", videoProvider: "meet", customerEmail: "pat@example.com" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      location: { type: "integration", integration: "google-meet" },
      attendee: { email: "pat@example.com" },
    });
    expect(r.meetingUrl).toBe("https://meet.google.com/cal-meet");
  });

  it("zoom maps to the zoom integration", async () => {
    fetchMock.mockResolvedValueOnce(json(booking({ location: "https://zoom.us/j/9" })));
    await cal().createBooking({ ...base, locationType: "video", videoProvider: "zoom" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).location).toEqual({ type: "integration", integration: "zoom" });
  });

  it("the event type doesn't have that location (Cal.com says 400): retries plain, still books, no link claimed", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ error: "location not allowed" }, 400))
      .mockResolvedValueOnce(json(booking({ location: "In person (organizer address)" })));
    const r = await cal().createBooking({ ...base, locationType: "video", videoProvider: "zoom" });
    expect(r.externalBookingId).toBe("uid-1");
    expect(r.meetingUrl).toBeNull();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).location).toBeUndefined();
  });

  it("non-video bookings send no location at all (unchanged)", async () => {
    fetchMock.mockResolvedValueOnce(json(booking()));
    const r = await cal().createBooking({ ...base, locationType: "in_person" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).location).toBeUndefined();
    expect(r.meetingUrl).toBeUndefined();
  });
});
