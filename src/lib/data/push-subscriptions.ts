import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { pushSubscriptions, type PushSubscriptionRow } from "@/db/schema";

/**
 * Web push subscriptions (one per device an owner opted in from). Every read
 * is scoped by client and, where the owner manages their own devices, by user.
 * See src/lib/push.ts for sending.
 */

export type PushKind = "text" | "booking";

export type SubscriptionInput = {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
};

/**
 * Save (or re-save) this device for this owner. The endpoint is unique
 * platform-wide: if the same browser re-subscribes — or another owner signs in
 * on the same device — the row moves to whoever subscribed last, so a device
 * never gets two businesses' alerts by accident.
 */
export async function upsertPushSubscription(
  clientId: string,
  userId: string,
  input: SubscriptionInput,
): Promise<PushSubscriptionRow> {
  const values = {
    clientId,
    userId,
    endpoint: input.endpoint,
    p256dh: input.p256dh,
    auth: input.auth,
    userAgent: input.userAgent ?? null,
    failureCount: 0,
    lastError: null,
  };
  const [row] = await db
    .insert(pushSubscriptions)
    .values(values)
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { ...values, updatedAt: new Date() },
    })
    .returning();
  if (!row) throw new Error("Failed to save push subscription");
  return row;
}

/** Remove one of this owner's devices. Returns whether a row was deleted. */
export async function deletePushSubscription(
  clientId: string,
  userId: string,
  endpoint: string,
): Promise<boolean> {
  const rows = await db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.clientId, clientId),
        eq(pushSubscriptions.userId, userId),
        eq(pushSubscriptions.endpoint, endpoint),
      ),
    )
    .returning({ id: pushSubscriptions.id });
  return rows.length > 0;
}

/** This owner's devices for this business, newest first. */
export async function listUserPushSubscriptions(
  clientId: string,
  userId: string,
): Promise<PushSubscriptionRow[]> {
  return db
    .select()
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.clientId, clientId), eq(pushSubscriptions.userId, userId)))
    .orderBy(desc(pushSubscriptions.createdAt));
}

/** Devices that want this kind of alert for this business. */
export async function listClientPushTargets(
  clientId: string,
  kind: PushKind,
): Promise<PushSubscriptionRow[]> {
  return db
    .select()
    .from(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.clientId, clientId),
        kind === "text" ? eq(pushSubscriptions.notifyTexts, true) : eq(pushSubscriptions.notifyBookings, true),
      ),
    )
    .limit(25);
}

/** Change which alerts one of this owner's devices gets. */
export async function updatePushPreferences(
  clientId: string,
  userId: string,
  endpoint: string,
  prefs: { notifyTexts?: boolean; notifyBookings?: boolean },
): Promise<boolean> {
  const rows = await db
    .update(pushSubscriptions)
    .set(prefs)
    .where(
      and(
        eq(pushSubscriptions.clientId, clientId),
        eq(pushSubscriptions.userId, userId),
        eq(pushSubscriptions.endpoint, endpoint),
      ),
    )
    .returning({ id: pushSubscriptions.id });
  return rows.length > 0;
}

/** The push service says this device is gone for good. */
export async function deletePushSubscriptionById(id: string): Promise<void> {
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, id));
}

export async function markPushDelivered(id: string): Promise<void> {
  await db
    .update(pushSubscriptions)
    .set({ lastSuccessAt: new Date(), failureCount: 0, lastError: null })
    .where(eq(pushSubscriptions.id, id));
}

/** A transient failure. After too many in a row the device is dropped. */
export async function markPushFailed(id: string, error: string): Promise<number> {
  const [row] = await db
    .update(pushSubscriptions)
    .set({ failureCount: sql`${pushSubscriptions.failureCount} + 1`, lastError: error.slice(0, 300) })
    .where(eq(pushSubscriptions.id, id))
    .returning({ failureCount: pushSubscriptions.failureCount });
  return row?.failureCount ?? 0;
}
