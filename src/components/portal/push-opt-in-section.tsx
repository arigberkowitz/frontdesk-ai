import { requireClientOwner } from "@/lib/auth-guard";
import { listUserPushSubscriptions } from "@/lib/data/push-subscriptions";
import { vapidPublicKey } from "@/lib/push";
import { PushOptIn, type PushDevice } from "./push-opt-in";

/**
 * Settings → Alerts "Phone notifications". Renders nothing at all until the
 * VAPID keys are set (LAUNCH.md), and nothing in an operator preview — a
 * device subscribed there would get this business's alerts.
 */
export async function PushOptInSection({ clientId, preview }: { clientId: string; preview: boolean }) {
  const key = vapidPublicKey();
  if (!key || preview) return null;
  const guard = await requireClientOwner(clientId);
  let devices: PushDevice[] = [];
  if (guard.ok) {
    // Fails soft (e.g. before 0017 runs): the card still renders, with no devices.
    const rows = await listUserPushSubscriptions(clientId, guard.user.id).catch(() => []);
    devices = rows.map((r) => ({
      endpoint: r.endpoint,
      userAgent: r.userAgent,
      createdAt: r.createdAt.toISOString(),
      notifyTexts: r.notifyTexts,
      notifyBookings: r.notifyBookings,
    }));
  }
  return <PushOptIn vapidPublicKey={key} devices={devices} canManage={guard.ok} />;
}
