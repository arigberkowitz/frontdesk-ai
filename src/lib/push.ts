import "server-only";
import type { PushSubscriptionRow } from "@/db/schema";
import {
  deletePushSubscriptionById,
  listClientPushTargets,
  markPushDelivered,
  markPushFailed,
  type PushKind,
} from "@/lib/data/push-subscriptions";
import { env } from "./env";
import { logger } from "./logger";
import type { PushPayload } from "./push-payloads";

/**
 * Web push to owners' phones (and desktops). The vendor library stays behind
 * this file; callers hand over a client id, a kind and a payload.
 *
 * Off unless all three VAPID_* vars are set — then nothing is queried or sent
 * and the opt-in stays hidden. Never throws: a notification is a nicety on top
 * of the email/SMS alert, and it must never fail a webhook or a booking.
 */

/** After this many failures in a row (not "gone" — those delete at once) a device is dropped. */
export const MAX_PUSH_FAILURES = 5;

export function pushConfigured(): boolean {
  // Read straight from env (same rule as integrations.webPush) so a caller's
  // partial env mock in tests reads as "off" rather than throwing.
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
}

/** The browser needs the public key to subscribe; null when push is off. */
export function vapidPublicKey(): string | null {
  return pushConfigured() ? env.VAPID_PUBLIC_KEY : null;
}

let vapidSet = false;
async function webPush() {
  const mod = await import("web-push");
  const wp = mod.default ?? mod;
  if (!vapidSet) {
    wp.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
    vapidSet = true;
  }
  return wp;
}

/** 404/410: the browser unsubscribed or the app was removed. 403: keys rotated. */
export function isGoneStatus(status: number | undefined): boolean {
  return status === 404 || status === 410 || status === 403;
}

/**
 * A subscription made in the last few minutes can briefly answer 410 while the
 * push service finishes registering it (seen with FCM: a test sent seconds
 * after "Turn on" came back Gone, the same one 20s later delivered). Deleting
 * it then would undo the owner's opt-in on their very first test, so a fresh
 * one only counts a failure.
 */
export const FRESH_SUBSCRIPTION_MS = 5 * 60_000;

export type PushResult = { sent: number; removed: number; failed: number; skipped?: string };

export async function sendPush(
  subs: (Pick<PushSubscriptionRow, "id" | "endpoint" | "p256dh" | "auth"> & { updatedAt?: Date | null })[],
  payload: PushPayload,
): Promise<PushResult> {
  const result: PushResult = { sent: 0, removed: 0, failed: 0 };
  if (!pushConfigured()) return { ...result, skipped: "not_configured" };
  if (subs.length === 0) return { ...result, skipped: "no_devices" };
  let wp: Awaited<ReturnType<typeof webPush>>;
  try {
    wp = await webPush();
  } catch (err) {
    logger.error("push.setup_failed", { error: err instanceof Error ? err.message : String(err) });
    return { ...result, failed: subs.length };
  }
  const body = JSON.stringify(payload);
  await Promise.all(
    subs.map(async (s) => {
      try {
        await wp.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, {
          TTL: 60 * 60 * 6,
          urgency: "high",
          // Inside a webhook: a slow push service must not hold the request.
          timeout: 4000,
        });
        result.sent++;
        await markPushDelivered(s.id).catch(() => {});
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        const fresh = s.updatedAt ? Date.now() - new Date(s.updatedAt).getTime() < FRESH_SUBSCRIPTION_MS : false;
        if (isGoneStatus(status) && !fresh) {
          result.removed++;
          await deletePushSubscriptionById(s.id).catch(() => {});
          logger.info("push.subscription_gone", { subscriptionId: s.id, status });
          return;
        }
        result.failed++;
        const message = err instanceof Error ? err.message : String(err);
        const failures = await markPushFailed(s.id, status ? `${status}: ${message}` : message).catch(() => 0);
        if (failures >= MAX_PUSH_FAILURES) {
          result.removed++;
          await deletePushSubscriptionById(s.id).catch(() => {});
        }
        logger.warn("push.send_failed", { subscriptionId: s.id, status, failures });
      }
    }),
  );
  return result;
}

/** Notify every device of this business that wants this kind of alert. */
export async function pushToClient(clientId: string, kind: PushKind, payload: PushPayload): Promise<PushResult> {
  if (!pushConfigured()) return { sent: 0, removed: 0, failed: 0, skipped: "not_configured" };
  try {
    const subs = await listClientPushTargets(clientId, kind);
    const r = await sendPush(subs, payload);
    if (r.sent || r.failed || r.removed) logger.info("push.sent", { clientId, kind, ...r });
    return r;
  } catch (err) {
    // Includes "relation push_subscriptions does not exist" before 0017 runs.
    logger.error("push.client_failed", {
      clientId,
      kind,
      error: err instanceof Error ? err.message : String(err),
    });
    return { sent: 0, removed: 0, failed: 0, skipped: "error" };
  }
}
