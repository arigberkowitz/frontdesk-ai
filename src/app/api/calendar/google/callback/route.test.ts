import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Google connect callback: CSRF nonce enforced, token stored encrypted, the
 * live agent republished so it starts offering booking, and the owner lands
 * back on the page they started from (Settings or Appointments).
 */

const USER = { id: "u1", orgId: "org1", role: "client_admin", clientId: "c1" };
let cookieNonce: string | undefined = "n1";
let mayEdit = true;
const updateClient = vi.fn(async (..._a: unknown[]) => {});
const applyClientEdit = vi.fn(async (..._a: unknown[]) => "synced");
const exchangeCodeForTokens = vi.fn(async (_code: string) => ({
  refreshToken: "refresh-1" as string | null,
  accessToken: "at",
  email: "owner@biz.test" as string | null,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (cookieNonce ? { value: cookieNonce } : undefined) }),
}));
vi.mock("@/lib/auth-guard", () => ({
  getCurrentDbUserSafe: async () => USER,
  userMayAccessClient: (u: typeof USER, id: string) => u.clientId === id,
  userMayEditClient: async (u: typeof USER, id: string) => u.clientId === id && mayEdit,
}));
vi.mock("@/lib/data/clients", () => ({
  getClient: async (_o: string, id: string) => ({ id }),
  updateClient: (...a: unknown[]) => updateClient(...a),
}));
vi.mock("@/lib/google-calendar", () => ({ exchangeCodeForTokens: (c: string) => exchangeCodeForTokens(c) }));
vi.mock("@/lib/crypto", () => ({ encryptSecret: (s: string) => `enc(${s})` }));
vi.mock("@/lib/agent-publish", () => ({ applyClientEdit: (...a: unknown[]) => applyClientEdit(...a) }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { GET } = await import("./route");
const hit = async (state: string, code = "code-1") =>
  GET(new Request(`https://app.test/api/calendar/google/callback?code=${code}&state=${encodeURIComponent(state)}`));

beforeEach(() => {
  cookieNonce = "n1";
  mayEdit = true;
  updateClient.mockClear();
  applyClientEdit.mockClear();
  exchangeCodeForTokens.mockClear();
});

describe("Google calendar OAuth callback", () => {
  it("stores the refresh token encrypted, republishes the agent, returns to Settings", async () => {
    const res = await hit("c1:n1:settings");
    expect(res.headers.get("location")).toBe("https://app.test/portal/settings/calendar?calendar=connected");
    expect(updateClient).toHaveBeenCalledWith(
      "org1",
      "c1",
      expect.objectContaining({ calendarProvider: "google", calendarSecret: "enc(refresh-1)", calendarAccount: "owner@biz.test" }),
    );
    expect(applyClientEdit).toHaveBeenCalledWith(USER, "c1");
  });

  it("defaults back to Appointments for the old state format", async () => {
    const res = await hit("c1:n1");
    expect(res.headers.get("location")).toBe("https://app.test/portal/appointments?calendar=connected");
  });

  it("rejects a nonce that doesn't match this browser's cookie (CSRF) and stores nothing", async () => {
    cookieNonce = "other";
    const res = await hit("c1:n1:settings");
    expect(res.headers.get("location")).toBe("https://app.test/portal/settings/calendar?calendar=error");
    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
    expect(updateClient).not.toHaveBeenCalled();
  });

  it("refuses another business's client id", async () => {
    const res = await hit("c-other:n1");
    expect(res.status).toBe(403);
    expect(updateClient).not.toHaveBeenCalled();
  });

  it("refuses staff who can't edit the AI (connecting replaces the calendar it books into)", async () => {
    mayEdit = false;
    const res = await hit("c1:n1:settings");
    expect(res.status).toBe(403);
    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
    expect(updateClient).not.toHaveBeenCalled();
  });

  it("no refresh token granted → 'noaccess', nothing saved, agent untouched", async () => {
    exchangeCodeForTokens.mockResolvedValueOnce({ refreshToken: null, accessToken: "at", email: null });
    const res = await hit("c1:n1");
    expect(res.headers.get("location")).toContain("calendar=noaccess");
    expect(updateClient).not.toHaveBeenCalled();
    expect(applyClientEdit).not.toHaveBeenCalled();
  });
});
