import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phone-notification actions: owner-only, never in an operator preview, only
 * real push-service endpoints, only your own devices, and the tenant comes
 * from the session (the request can't name a business).
 */

const m = vi.hoisted(() => ({
  configured: true,
  preview: false,
  ownerOk: true,
  upsert: vi.fn(async (..._a: unknown[]) => ({ id: "s1" })),
  remove: vi.fn(async (..._a: unknown[]) => true),
  update: vi.fn(async (..._a: unknown[]) => true),
  list: vi.fn(async (..._a: unknown[]) => [] as { id: string; endpoint: string; p256dh: string; auth: string }[]),
  sendPush: vi.fn(async (..._a: unknown[]) => ({ sent: 1, removed: 0, failed: 0 })),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/auth-guard", () => ({
  resolvePortalClient: async () => ({ clientId: "c1", preview: m.preview }),
  requireClientOwner: async (clientId: string) =>
    m.ownerOk ? { ok: true, user: { id: "u1", clientId } } : { ok: false, error: "Only the business owner can change this." },
}));
vi.mock("@/lib/data/clients", () => ({ getClientByIdUnsafe: async () => ({ id: "c1", name: "Bright Smile" }) }));
vi.mock("@/lib/data/push-subscriptions", () => ({
  upsertPushSubscription: (...a: unknown[]) => m.upsert(...a),
  deletePushSubscription: (...a: unknown[]) => m.remove(...a),
  updatePushPreferences: (...a: unknown[]) => m.update(...a),
  listUserPushSubscriptions: (...a: unknown[]) => m.list(...a),
}));
vi.mock("@/lib/push", () => ({
  pushConfigured: () => m.configured,
  sendPush: (...a: unknown[]) => m.sendPush(...a),
}));

const actions = await import("./push");

const EP = "https://fcm.googleapis.com/fcm/send/abc123";
const sub = { endpoint: EP, expirationTime: null, keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" } };

beforeEach(() => {
  m.configured = true;
  m.preview = false;
  m.ownerOk = true;
  for (const f of [m.upsert, m.remove, m.update, m.list, m.sendPush]) f.mockClear();
  m.list.mockResolvedValue([]);
});

describe("savePushSubscriptionAction", () => {
  it("saves the owner's device for the session's business", async () => {
    const r = await actions.savePushSubscriptionAction(sub, "Mozilla/5.0 (iPhone)");
    expect(r.ok).toBe(true);
    expect(m.upsert).toHaveBeenCalledWith("c1", "u1", {
      endpoint: EP,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      userAgent: "Mozilla/5.0 (iPhone)",
    });
  });

  it("refuses staff, operator previews, and an unconfigured app", async () => {
    m.ownerOk = false;
    expect((await actions.savePushSubscriptionAction(sub)).ok).toBe(false);
    m.ownerOk = true;
    m.preview = true;
    expect((await actions.savePushSubscriptionAction(sub)).ok).toBe(false);
    m.preview = false;
    m.configured = false;
    expect((await actions.savePushSubscriptionAction(sub)).ok).toBe(false);
    expect(m.upsert).not.toHaveBeenCalled();
  });

  it("refuses endpoints that aren't a real push service, and junk keys", async () => {
    for (const bad of [
      { ...sub, endpoint: "https://internal.example.com/hook" },
      { ...sub, endpoint: "http://fcm.googleapis.com/fcm/send/x" },
      { ...sub, keys: { p256dh: "<script>", auth: "x" } },
      null,
      "nope",
    ]) {
      expect((await actions.savePushSubscriptionAction(bad)).ok).toBe(false);
    }
    expect(m.upsert).not.toHaveBeenCalled();
  });
});

describe("other device actions", () => {
  it("remove and preferences are scoped to the owner and validated", async () => {
    await actions.removePushSubscriptionAction(EP);
    expect(m.remove).toHaveBeenCalledWith("c1", "u1", EP);
    expect((await actions.removePushSubscriptionAction("https://evil.test/x")).ok).toBe(false);
    await actions.updatePushPreferencesAction(EP, { notifyTexts: false, junk: 1 } as never);
    expect(m.update).toHaveBeenCalledWith("c1", "u1", EP, { notifyTexts: false });
    expect((await actions.updatePushPreferencesAction(EP, {})).ok).toBe(false);
  });

  it("test push goes only to the owner's own matching device", async () => {
    expect((await actions.sendTestPushAction(EP)).ok).toBe(false); // not theirs / not on
    expect(m.sendPush).not.toHaveBeenCalled();
    const row = { id: "s1", endpoint: EP, p256dh: "p", auth: "a" };
    m.list.mockResolvedValue([row, { ...row, id: "s2", endpoint: EP + "other" }]);
    const r = await actions.sendTestPushAction(EP);
    expect(r.ok).toBe(true);
    expect(m.list).toHaveBeenCalledWith("c1", "u1");
    expect(m.sendPush).toHaveBeenCalledWith([row], expect.objectContaining({ title: "Notifications are on" }));
  });
});
