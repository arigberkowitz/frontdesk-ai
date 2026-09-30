import { beforeEach, describe, expect, it, vi } from "vitest";

/** Disconnect: clears the stored credential, revokes a Google grant, republishes. */

const USER = { id: "u1", orgId: "org1" };
let client: Record<string, unknown> = {};
let editorOk = true;
const updateClient = vi.fn(async (..._a: unknown[]) => {});
const applyClientEdit = vi.fn(async (..._a: unknown[]) => "synced");
const revokeGoogleToken = vi.fn(async (_t: string) => true);

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth-guard", () => ({
  requireClientEditor: async () => (editorOk ? { ok: true, user: USER } : { ok: false, error: "locked" }),
}));
vi.mock("@/lib/data/clients", () => ({
  assertClientInOrg: async () => client,
  updateClient: (...a: unknown[]) => updateClient(...a),
}));
vi.mock("@/lib/agent-publish", () => ({ applyClientEdit: (...a: unknown[]) => applyClientEdit(...a) }));
vi.mock("@/lib/crypto", () => ({
  encryptSecret: (s: string) => `enc(${s})`,
  decryptSecret: (s: string) => {
    if (!s.startsWith("enc(")) throw new Error("bad");
    return s.slice(4, -1);
  },
}));
vi.mock("@/lib/google-calendar", () => ({ revokeGoogleToken: (t: string) => revokeGoogleToken(t) }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { disconnectCalendarAction } = await import("./calendar");
const disconnect = () => {
  const f = new FormData();
  f.set("clientId", "c1");
  return disconnectCalendarAction(f);
};

beforeEach(() => {
  editorOk = true;
  for (const f of [updateClient, applyClientEdit, revokeGoogleToken]) f.mockClear();
});

describe("disconnectCalendarAction", () => {
  it("Google: revokes the grant, clears every calendar field, republishes the agent", async () => {
    client = { id: "c1", calendarProvider: "google", calendarSecret: "enc(refresh-1)" };
    await disconnect();
    expect(revokeGoogleToken).toHaveBeenCalledWith("refresh-1");
    expect(updateClient).toHaveBeenCalledWith("org1", "c1", {
      calendarProvider: null,
      calendarSecret: null,
      calendarId: null,
      calendarAccount: null,
      calendarConnectedAt: null,
    });
    expect(applyClientEdit).toHaveBeenCalled();
  });

  it("still disconnects when the revoke fails or the secret is unreadable", async () => {
    client = { id: "c1", calendarProvider: "google", calendarSecret: "garbage" };
    await disconnect();
    expect(revokeGoogleToken).not.toHaveBeenCalled();
    expect(updateClient).toHaveBeenCalled();
    client = { id: "c1", calendarProvider: "google", calendarSecret: "enc(r)" };
    revokeGoogleToken.mockResolvedValueOnce(false);
    await disconnect();
    expect(updateClient).toHaveBeenCalledTimes(2);
  });

  it("Microsoft/Cal.com: no Google revoke, just clears", async () => {
    client = { id: "c1", calendarProvider: "microsoft", calendarSecret: "enc(r)" };
    await disconnect();
    expect(revokeGoogleToken).not.toHaveBeenCalled();
    expect(updateClient).toHaveBeenCalled();
  });

  it("does nothing for someone who may not edit", async () => {
    editorOk = false;
    client = { id: "c1", calendarProvider: "google", calendarSecret: "enc(r)" };
    await disconnect();
    expect(updateClient).not.toHaveBeenCalled();
    expect(revokeGoogleToken).not.toHaveBeenCalled();
  });
});
