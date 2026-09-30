import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Calendar sync plumbing: busy-overlap math, the Google/Microsoft providers'
 * busy lookups (raw REST, fetch stubbed), the OAuth state round-trip, and the
 * Microsoft env-var names.
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
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const dbSet = vi.fn();
vi.mock("@/db", () => ({
  db: { update: () => ({ set: (v: unknown) => ({ where: async () => dbSet(v) }) }) },
}));

const { overlapsBusy, calendarSlotIsFree, getBookingProviderForClient } = await import("./booking");
const { encryptSecret, decryptSecret } = await import("./crypto");
const oauth = await import("./calendar-oauth");

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  dbSet.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("overlapsBusy", () => {
  const s = Date.parse("2031-03-04T20:00:00Z");
  const e = Date.parse("2031-03-04T21:00:00Z");
  it("detects any overlap, ignores touching edges and junk", () => {
    expect(overlapsBusy([{ start: "2031-03-04T20:59:00Z", end: "2031-03-04T22:00:00Z" }], s, e)).toBe(true);
    expect(overlapsBusy([{ start: "2031-03-04T19:00:00Z", end: "2031-03-04T23:00:00Z" }], s, e)).toBe(true);
    expect(overlapsBusy([{ start: "2031-03-04T21:00:00Z", end: "2031-03-04T22:00:00Z" }], s, e)).toBe(false);
    expect(overlapsBusy([{ start: "2031-03-04T19:00:00Z", end: "2031-03-04T20:00:00Z" }], s, e)).toBe(false);
    expect(overlapsBusy([{ start: "nope", end: "nope" }], s, e)).toBe(false);
  });
  it("providers without a busy lookup (Cal.com refuses clashes itself) pass", async () => {
    const p = { name: "x", isConfigured: () => true } as unknown as Parameters<typeof calendarSlotIsFree>[0];
    expect(await calendarSlotIsFree(p, new Date(s), new Date(e))).toBe(true);
  });
});

describe("Google provider busy lookup", () => {
  it("refreshes the token then asks freeBusy for exactly that window on the connected calendar", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ access_token: "at-1" }))
      .mockResolvedValueOnce(
        json({ calendars: { primary: { busy: [{ start: "2031-03-04T20:30:00Z", end: "2031-03-04T21:30:00Z" }] } } }),
      );
    const provider = getBookingProviderForClient({
      id: "c1",
      calendarProvider: "google",
      calendarSecret: encryptSecret("refresh-1"),
      calendarId: "primary",
    });
    const free = await calendarSlotIsFree(
      provider,
      new Date("2031-03-04T20:00:00Z"),
      new Date("2031-03-04T21:00:00Z"),
    );
    expect(free).toBe(false);
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0];
    expect(tokenUrl).toBe("https://oauth2.googleapis.com/token");
    expect(String(tokenInit.body)).toContain("refresh_token=refresh-1");
    const [fbUrl, fbInit] = fetchMock.mock.calls[1];
    expect(fbUrl).toBe("https://www.googleapis.com/calendar/v3/freeBusy");
    expect(fbInit.headers.Authorization).toBe("Bearer at-1");
    expect(JSON.parse(fbInit.body)).toEqual({
      timeMin: "2031-03-04T20:00:00.000Z",
      timeMax: "2031-03-04T21:00:00.000Z",
      items: [{ id: "primary" }],
    });
  });

  it("a revoked grant surfaces as an error (the booking path turns that into 'not available')", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "invalid_grant" }, 400));
    const provider = getBookingProviderForClient({
      id: "c1",
      calendarProvider: "google",
      calendarSecret: encryptSecret("refresh-1"),
      calendarId: "primary",
    });
    await expect(
      calendarSlotIsFree(provider, new Date("2031-03-04T20:00:00Z"), new Date("2031-03-04T21:00:00Z")),
    ).rejects.toThrow(/token refresh failed/);
  });
});

describe("Microsoft provider busy lookup", () => {
  it("reads calendarView (ignoring 'free' events) and persists a rotated refresh token, encrypted", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ access_token: "ms-at", refresh_token: "refresh-2" }))
      .mockResolvedValueOnce(
        json({
          value: [
            { start: { dateTime: "2031-03-04T20:15:00.0000000" }, end: { dateTime: "2031-03-04T20:45:00.0000000" }, showAs: "free" },
            { start: { dateTime: "2031-03-04T22:00:00.0000000" }, end: { dateTime: "2031-03-04T23:00:00.0000000" }, showAs: "busy" },
          ],
        }),
      );
    const provider = getBookingProviderForClient({
      id: "c1",
      calendarProvider: "microsoft",
      calendarSecret: encryptSecret("refresh-1"),
    });
    const free = await calendarSlotIsFree(
      provider,
      new Date("2031-03-04T20:00:00Z"),
      new Date("2031-03-04T21:00:00Z"),
    );
    expect(free).toBe(true);
    expect(String(fetchMock.mock.calls[1][0])).toContain("https://graph.microsoft.com/v1.0/me/calendarView?");
    expect(dbSet).toHaveBeenCalledTimes(1);
    const stored = (dbSet.mock.calls[0][0] as { calendarSecret: string }).calendarSecret;
    expect(stored).not.toContain("refresh-2");
    expect(decryptSecret(stored)).toBe("refresh-2");
  });
});

describe("OAuth state round-trip", () => {
  it("carries client + nonce, and an allowlisted return page", () => {
    const st = oauth.buildCalendarOAuthState("c1", "n1", "settings");
    expect(oauth.parseCalendarOAuthState(st)).toEqual({ clientId: "c1", nonce: "n1", from: "settings" });
    // Old-format states (in flight during deploy) still parse, back to Appointments.
    expect(oauth.parseCalendarOAuthState("c1:n1")).toEqual({ clientId: "c1", nonce: "n1", from: "appointments" });
    expect(oauth.buildCalendarOAuthState("c1", "n1", "appointments")).toBe("c1:n1");
  });
  it("never redirects anywhere but the two portal pages", () => {
    expect(oauth.calendarReturnFrom("https://evil.test")).toBe("appointments");
    expect(oauth.parseCalendarOAuthState("c1:n1://evil.test").from).toBe("appointments");
    expect(oauth.calendarReturnPath("settings", "connected")).toBe("/portal/settings/calendar?calendar=connected");
    expect(oauth.calendarReturnPath("appointments", "error")).toBe("/portal/appointments?calendar=error");
  });
});
