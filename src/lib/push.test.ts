import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Sending: off without VAPID keys (web-push never even loads); delivered
 * devices are marked; a device the push service says is gone (404/410/403) is
 * deleted at once; transient failures count up and drop the device at the cap;
 * nothing ever throws.
 */

const env = { VAPID_PUBLIC_KEY: "", VAPID_PRIVATE_KEY: "", VAPID_SUBJECT: "" };
const sendNotification = vi.fn();
const setVapidDetails = vi.fn();
const data = {
  listClientPushTargets: vi.fn(),
  deletePushSubscriptionById: vi.fn(async () => {}),
  markPushDelivered: vi.fn(async () => {}),
  markPushFailed: vi.fn(async () => 1),
};

vi.mock("./env", () => ({ env }));
vi.mock("./logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("web-push", () => ({ default: { sendNotification, setVapidDetails } }));
vi.mock("@/lib/data/push-subscriptions", () => data);

const { pushConfigured, pushToClient, sendPush, vapidPublicKey, MAX_PUSH_FAILURES } = await import("./push");

const payload = { title: "New text from (415) 555-0100", body: "Tap to read and reply.", url: "/portal/messages", tag: "t" };
const sub = (id: string) => ({ id, endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, p256dh: "p".repeat(20), auth: "a".repeat(12) });

beforeEach(() => {
  Object.assign(env, { VAPID_PUBLIC_KEY: "BPub", VAPID_PRIVATE_KEY: "priv", VAPID_SUBJECT: "mailto:x@y.z" });
  sendNotification.mockReset().mockResolvedValue({ statusCode: 201 });
  for (const f of Object.values(data)) f.mockClear();
  data.listClientPushTargets.mockResolvedValue([sub("a"), sub("b")]);
  data.markPushFailed.mockResolvedValue(1);
});

describe("push", () => {
  it("is off (and hidden) unless all three VAPID vars are set", async () => {
    env.VAPID_SUBJECT = "";
    expect(pushConfigured()).toBe(false);
    expect(vapidPublicKey()).toBeNull();
    const r = await pushToClient("c1", "text", payload);
    expect(r.skipped).toBe("not_configured");
    expect(data.listClientPushTargets).not.toHaveBeenCalled();
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("sends the JSON payload to every device and marks them delivered", async () => {
    expect(vapidPublicKey()).toBe("BPub");
    const r = await pushToClient("c1", "booking", payload);
    expect(data.listClientPushTargets).toHaveBeenCalledWith("c1", "booking");
    expect(r).toMatchObject({ sent: 2, failed: 0, removed: 0 });
    expect(setVapidDetails).toHaveBeenCalledWith("mailto:x@y.z", "BPub", "priv");
    const [target, body, opts] = sendNotification.mock.calls[0];
    expect(target).toEqual({ endpoint: sub("a").endpoint, keys: { p256dh: sub("a").p256dh, auth: sub("a").auth } });
    expect(JSON.parse(body)).toEqual(payload);
    expect(opts.timeout).toBeLessThanOrEqual(5000);
    expect(data.markPushDelivered).toHaveBeenCalledTimes(2);
  });

  it("deletes a device the push service says is gone", async () => {
    sendNotification.mockImplementation(async (t: { endpoint: string }) => {
      if (t.endpoint.endsWith("/a")) throw Object.assign(new Error("Gone"), { statusCode: 410 });
      return { statusCode: 201 };
    });
    const r = await sendPush([sub("a"), sub("b")], payload);
    expect(r).toMatchObject({ sent: 1, removed: 1, failed: 0 });
    expect(data.deletePushSubscriptionById).toHaveBeenCalledWith("a");
    expect(data.markPushFailed).not.toHaveBeenCalled();
  });

  it("a just-made subscription answering Gone is a failure, not a deletion (push service still registering)", async () => {
    sendNotification.mockRejectedValue(Object.assign(new Error("Gone"), { statusCode: 410 }));
    const r = await sendPush([{ ...sub("a"), updatedAt: new Date(Date.now() - 20_000) }], payload);
    expect(r).toMatchObject({ sent: 0, removed: 0, failed: 1 });
    expect(data.deletePushSubscriptionById).not.toHaveBeenCalled();
    const old = await sendPush([{ ...sub("b"), updatedAt: new Date(Date.now() - 3_600_000) }], payload);
    expect(old.removed).toBe(1);
  });

  it("counts transient failures and drops the device at the cap", async () => {
    sendNotification.mockRejectedValue(Object.assign(new Error("Server error"), { statusCode: 502 }));
    data.markPushFailed.mockResolvedValueOnce(1).mockResolvedValueOnce(MAX_PUSH_FAILURES);
    const r = await sendPush([sub("a"), sub("b")], payload);
    expect(r.failed).toBe(2);
    expect(data.markPushFailed).toHaveBeenCalledWith("a", expect.stringContaining("502"));
    expect(data.deletePushSubscriptionById).toHaveBeenCalledTimes(1);
  });

  it("never throws, even when the table doesn't exist yet", async () => {
    data.listClientPushTargets.mockRejectedValue(new Error('relation "push_subscriptions" does not exist'));
    await expect(pushToClient("c1", "text", payload)).resolves.toMatchObject({ sent: 0, skipped: "error" });
  });

  it("no devices: nothing sent", async () => {
    data.listClientPushTargets.mockResolvedValue([]);
    const r = await pushToClient("c1", "text", payload);
    expect(r.skipped).toBe("no_devices");
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
