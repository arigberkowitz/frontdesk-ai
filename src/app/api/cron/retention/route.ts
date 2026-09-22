import { runRetention } from "@/lib/retention";
import { runWaitlistHousekeeping } from "@/lib/agents/waitlist-housekeeping";
import { runTrialLapse } from "@/lib/trial-lapse";
import { runTrialReminders } from "@/lib/lifecycle";
import { authorizeCron } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Retention purge cron — makes the privacy policy's deletion promise true.
 * Daily; almost every run deletes nothing and that's the correct outcome.
 * Same auth as the other crons: `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: Request): Promise<Response> {
  const denied = authorizeCron(req, "retention");
  if (denied) return denied;

  const result = await runRetention();
  // Rides along here rather than claiming a cron slot of its own: it sends
  // nothing, it only has to run about once a day, and Hobby crons are
  // once-a-day regardless.
  const waitlist = await runWaitlistHousekeeping();
  // Free trials that ended unpaid hand their phone number back — the one
  // thing a lapsed signup would otherwise keep costing. Same daily slot.
  const lapsed = await runTrialLapse();
  // And the two check-in emails before that point (7 days out, 1 day out).
  const reminders = await runTrialReminders();
  return Response.json({
    ok: true,
    clientsPurged: result.clientsPurged,
    webhookPayloadsCleared: result.webhookPayloadsCleared,
    waitlistExpired: waitlist.expired,
    waitlistRequeued: waitlist.requeued,
    trialNumbersReleased: lapsed.released,
    trialReleaseFailed: lapsed.failed,
    trialRemindersSent: reminders.sent,
    trialRemindersFailed: reminders.failed,
  });
}
