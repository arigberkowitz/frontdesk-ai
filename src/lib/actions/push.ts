"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireClientOwner, resolvePortalClient } from "@/lib/auth-guard";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import {
  deletePushSubscription,
  listUserPushSubscriptions,
  updatePushPreferences,
  upsertPushSubscription,
} from "@/lib/data/push-subscriptions";
import { pushConfigured, sendPush } from "@/lib/push";
import { isAllowedPushEndpoint, testPushPayload } from "@/lib/push-payloads";
import { logger } from "@/lib/logger";
import type { ActionState } from "./types";

/**
 * Phone notifications (web push), Settings → Alerts. Owner-only, own devices
 * only, and never while an operator is previewing someone else's portal: a
 * device subscribed during a preview would get that business's alerts.
 * The tenant always comes from the session, never from the request.
 */

const OFF = "Phone notifications aren't switched on for this app yet.";
const b64url = z.string().min(8).max(256).regex(/^[A-Za-z0-9_-]+=*$/);
const subscriptionSchema = z.object({
  endpoint: z.string().max(1024).refine(isAllowedPushEndpoint, "Unsupported push service"),
  keys: z.object({ p256dh: b64url, auth: b64url }),
});
const endpointSchema = z.string().max(1024).refine(isAllowedPushEndpoint);

async function ownerContext(): Promise<
  { ok: true; clientId: string; userId: string } | { ok: false; error: string }
> {
  const { clientId, preview } = await resolvePortalClient();
  if (preview) return { ok: false, error: "Turn notifications on from the owner's own account." };
  const guard = await requireClientOwner(clientId);
  if (!guard.ok) return { ok: false, error: guard.error };
  return { ok: true, clientId, userId: guard.user.id };
}

/** Save this browser's push subscription for the signed-in owner. */
export async function savePushSubscriptionAction(
  subscription: unknown,
  userAgent?: string,
): Promise<ActionState> {
  if (!pushConfigured()) return { ok: false, error: OFF };
  const ctx = await ownerContext();
  if (!ctx.ok) return ctx;
  const parsed = subscriptionSchema.safeParse(subscription);
  if (!parsed.success) return { ok: false, error: "This browser's notification service isn't supported." };
  try {
    await upsertPushSubscription(ctx.clientId, ctx.userId, {
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
      userAgent: userAgent ? userAgent.slice(0, 300) : null,
    });
  } catch (err) {
    logger.error("push.subscribe_failed", {
      clientId: ctx.clientId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: "Couldn't save this device. Try again in a minute." };
  }
  revalidatePath("/portal/settings/alerts");
  return { ok: true, message: "Notifications are on for this device." };
}

/** Forget one of the owner's devices (this one, or another from the list). */
export async function removePushSubscriptionAction(endpoint: string): Promise<ActionState> {
  const ctx = await ownerContext();
  if (!ctx.ok) return ctx;
  if (!endpointSchema.safeParse(endpoint).success) return { ok: false, error: "Unknown device." };
  await deletePushSubscription(ctx.clientId, ctx.userId, endpoint);
  revalidatePath("/portal/settings/alerts");
  return { ok: true, message: "Notifications are off for that device." };
}

/** Which alerts a device gets. */
export async function updatePushPreferencesAction(
  endpoint: string,
  prefs: { notifyTexts?: boolean; notifyBookings?: boolean },
): Promise<ActionState> {
  const ctx = await ownerContext();
  if (!ctx.ok) return ctx;
  if (!endpointSchema.safeParse(endpoint).success) return { ok: false, error: "Unknown device." };
  const clean: { notifyTexts?: boolean; notifyBookings?: boolean } = {};
  if (typeof prefs?.notifyTexts === "boolean") clean.notifyTexts = prefs.notifyTexts;
  if (typeof prefs?.notifyBookings === "boolean") clean.notifyBookings = prefs.notifyBookings;
  if (!Object.keys(clean).length) return { ok: false, error: "Nothing to change." };
  const ok = await updatePushPreferences(ctx.clientId, ctx.userId, endpoint, clean);
  if (!ok) return { ok: false, error: "That device isn't on any more. Turn it on again." };
  revalidatePath("/portal/settings/alerts");
  return { ok: true };
}

/** A sample notification to the owner's own device — nobody else. */
export async function sendTestPushAction(endpoint: string): Promise<ActionState> {
  if (!pushConfigured()) return { ok: false, error: OFF };
  const ctx = await ownerContext();
  if (!ctx.ok) return ctx;
  const mine = (await listUserPushSubscriptions(ctx.clientId, ctx.userId)).filter(
    (s) => s.endpoint === endpoint,
  );
  if (!mine.length) return { ok: false, error: "This device isn't on yet. Turn it on first." };
  const client = await getClientByIdUnsafe(ctx.clientId);
  const r = await sendPush(mine, testPushPayload(client?.name ?? "your business"));
  if (r.sent) return { ok: true, message: "Sent. It should pop up in a few seconds." };
  if (r.removed) {
    revalidatePath("/portal/settings/alerts");
    return { ok: false, error: "This device stopped accepting notifications. Turn it on again." };
  }
  return {
    ok: false,
    error: "This device's notification service didn't take it yet. New devices can need a minute — try the test again shortly.",
  };
}
