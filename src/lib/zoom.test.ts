import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: { APP_URL: "https://app.test", ZOOM_CLIENT_ID: "zid", ZOOM_CLIENT_SECRET: "zsecret", CREDENTIALS_SECRET: "test-credentials-secret" },
  integrations: { zoom: () => true },
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const dbSet = vi.fn();
let storedSecret: string | null = null;
vi.mock("@/db", () => ({
  db: {
    update: () => ({ set: (v: unknown) => ({ where: async () => dbSet(v) }) }),
    query: { clients: { findFirst: async () => ({ zoomSecret: storedSecret }) } },
  },
}));

const zoom = await import("./zoom");

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  dbSet.mockReset();
  storedSecret = null;
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const seal = (t: Partial<import("./zoom").ZoomTokens>) =>
  zoom.sealZoomTokens({ r: "refresh-1", a: "access-1", e: Date.now() + 600_000, ...t });

describe("connect flow", () => {
  it("sends the owner to Zoom's authorize page with our redirect and state", () => {
    const u = new URL(zoom.zoomAuthUrl("state-1"));
    expect(u.origin + u.pathname).toBe("https://zoom.us/oauth/authorize");
    expect(u.searchParams.get("client_id")).toBe("zid");
    expect(u.searchParams.get("redirect_uri")).toBe("https://app.test/api/calendar/zoom/callback");
    expect(u.searchParams.get("state")).toBe("state-1");
    expect(u.searchParams.get("response_type")).toBe("code");
  });

  it("exchanges the code with Basic auth and reads the account email", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ access_token: "a", refresh_token: "r", expires_in: 3600 }))
      .mockResolvedValueOnce(json({ email: "owner@biz.test" }));
    const r = await zoom.exchangeZoomCode("code-1");
    expect(r.email).toBe("owner@biz.test");
    expect(r.tokens.r).toBe("r");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://zoom.us/oauth/token");
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from("zid:zsecret").toString("base64")}`);
    expect(String(init.body)).toContain("grant_type=authorization_code");
    expect(String(init.body)).toContain("code=code-1");
  });

  it("stores tokens encrypted: the sealed value never contains the token", () => {
    const sealed = seal({ r: "SUPER-SECRET-REFRESH" });
    expect(sealed).not.toContain("SUPER-SECRET-REFRESH");
    expect(zoom.openZoomTokens(sealed)?.r).toBe("SUPER-SECRET-REFRESH");
    expect(zoom.openZoomTokens("garbage")).toBeNull();
  });
});

describe("access tokens", () => {
  it("reuses a still-valid access token without calling Zoom", async () => {
    expect(await zoom.getZoomAccessToken({ id: "c1", zoomSecret: seal({}) })).toBe("access-1");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes an expired one and saves the ROTATED refresh token", async () => {
    fetchMock.mockResolvedValueOnce(json({ access_token: "access-2", refresh_token: "refresh-2", expires_in: 3600 }));
    const old = seal({ e: Date.now() - 1000 });
    expect(await zoom.getZoomAccessToken({ id: "c1", zoomSecret: old })).toBe("access-2");
    expect(String(fetchMock.mock.calls[0][1].body)).toContain("refresh_token=refresh-1");
    expect(dbSet).toHaveBeenCalledTimes(1);
    const saved = zoom.openZoomTokens((dbSet.mock.calls[0][0] as { zoomSecret: string }).zoomSecret);
    expect(saved?.r).toBe("refresh-2");
  });

  it("if another request already rotated the token, uses that instead of failing", async () => {
    const old = seal({ e: Date.now() - 1000 });
    storedSecret = seal({ r: "refresh-2", a: "access-fresh", e: Date.now() + 600_000 });
    fetchMock.mockResolvedValueOnce(json({ reason: "Invalid Token!", error: "invalid_grant" }, 400));
    expect(await zoom.getZoomAccessToken({ id: "c1", zoomSecret: old })).toBe("access-fresh");
  });

  it("a dead refresh token is a reconnect-needed error, not a crash", async () => {
    const old = seal({ e: Date.now() - 1000 });
    storedSecret = old;
    fetchMock.mockResolvedValueOnce(json({ error: "invalid_grant" }, 400));
    await expect(zoom.getZoomAccessToken({ id: "c1", zoomSecret: old })).rejects.toBeInstanceOf(zoom.ZoomAuthError);
  });

  it("no connection at all is the same error", async () => {
    await expect(zoom.getZoomAccessToken({ id: "c1", zoomSecret: null })).rejects.toBeInstanceOf(zoom.ZoomAuthError);
  });
});

describe("meetings", () => {
  const conn = () => ({ id: "c1", zoomSecret: seal({}) });

  it("creates a scheduled meeting with a waiting room and returns the join link", async () => {
    fetchMock.mockResolvedValueOnce(json({ id: 123456789, join_url: "https://zoom.us/j/123456789?pwd=abc" }, 201));
    const m = await zoom.createZoomMeeting(conn(), {
      topic: "Consult — Acme",
      startIso: "2031-03-04T20:00:00.000Z",
      durationMin: 45,
      timezone: "America/New_York",
    });
    expect(m).toEqual({ id: "123456789", joinUrl: "https://zoom.us/j/123456789?pwd=abc" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.zoom.us/v2/users/me/meetings");
    expect(init.headers.Authorization).toBe("Bearer access-1");
    expect(JSON.parse(init.body)).toMatchObject({
      topic: "Consult — Acme",
      type: 2,
      start_time: "2031-03-04T20:00:00Z",
      duration: 45,
      timezone: "America/New_York",
      settings: { waiting_room: true, join_before_host: false },
    });
  });

  it("an API error throws (the caller books without a link and alerts the owner)", async () => {
    fetchMock.mockResolvedValueOnce(json({ code: 124, message: "Invalid access token." }, 401));
    await expect(zoom.createZoomMeeting(conn(), { topic: "x", startIso: "2031-03-04T20:00:00Z", durationMin: 30, timezone: "UTC" })).rejects.toBeInstanceOf(zoom.ZoomAuthError);
    fetchMock.mockResolvedValueOnce(json({ message: "boom" }, 500));
    await expect(zoom.createZoomMeeting(conn(), { topic: "x", startIso: "2031-03-04T20:00:00Z", durationMin: 30, timezone: "UTC" })).rejects.toThrow(/500/);
  });

  it("reschedules and deletes; an already-deleted meeting (404) is fine", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await zoom.updateZoomMeetingTime(conn(), "55", { startIso: "2031-03-05T20:00:00.000Z", durationMin: 30, timezone: "UTC" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.zoom.us/v2/meetings/55");
    expect(fetchMock.mock.calls[0][1].method).toBe("PATCH");
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(zoom.deleteZoomMeeting(conn(), "55")).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[1][1].method).toBe("DELETE");
  });
});
