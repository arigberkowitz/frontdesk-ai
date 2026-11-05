import "server-only";
import { dueSms, getTextingPrefs, markSms } from "@/lib/data/texting-prefs";
import { isOptedOut } from "@/lib/data/sms-optouts";
import { notifier } from "@/lib/notifier";
import { logger } from "@/lib/logger";

/**
 * Release texts held for quiet hours. Re-checks STOP and the texting switch
 * at send time: either may have changed overnight.
 */
export async function flushSmsQueue(now = new Date()): Promise<{ sent: number; dropped: number; failed: number }> {
  const out = { sent: 0, dropped: 0, failed: 0 };
  for (const row of await dueSms(now)) {
    try {
      const prefs = await getTextingPrefs(row.clientId);
      if (prefs && !prefs.textingEnabled) {
        await markSms(row.id, "dropped", "texting_off");
        out.dropped++;
        continue;
      }
      if (await isOptedOut(row.toPhone, row.clientId)) {
        await markSms(row.id, "dropped", "opted_out");
        out.dropped++;
        continue;
      }
      const r = await notifier.sendSms({ to: row.toPhone, body: row.body, log: row.log, fromQueue: true });
      await markSms(row.id, r.ok ? "sent" : "failed", r.ok ? (r.id ?? null) : (r.error ?? "failed"));
      if (r.ok) out.sent++;
      else out.failed++;
    } catch (err) {
      out.failed++;
      logger.warn("sms_queue.flush_failed", { id: row.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}
