import { sendAppointmentReminders } from "@/lib/appointment-texts";
import { authorizeCron } from "@/lib/cron-auth";

export const runtime = "nodejs";
// Sweeping every client takes longer than the default 10s ceiling, and hitting
// it kills the run partway through — some businesses texted, some silently
// not, differently each night.
export const maxDuration = 300;

/**
 * The day-before reminder sweep.
 *
 * Runs mid-morning UTC so it lands inside working hours across the US; each
 * client is then checked against its own local clock before anyone is texted,
 * because a reminder that arrives at 4am is worse than no reminder.
 */
export async function GET(req: Request): Promise<Response> {
  const denied = authorizeCron(req, "appointment-reminders");
  if (denied) return denied;

  const result = await sendAppointmentReminders();
  return Response.json({ ok: result.failed === 0, ...result }, {
    status: result.failed === 0 ? 200 : 500,
  });
}
