import { sendDigests, sendWeeklyReports } from "@/lib/digest";
import { authorizeCron } from "@/lib/cron-auth";

export const runtime = "nodejs";
// Sweeping every client takes longer than the default 10s ceiling, and hitting
// it kills the run partway through — some businesses emailed, some silently
// not, differently each night.
export const maxDuration = 300;

/**
 * Monday cron: weekly SMS digest + the weekly owner report email. A dedicated
 * path (rather than /api/cron/digest?period=weekly) so the Vercel cron entry
 * needs no query string — if a platform strips it, the weekly run would
 * silently degrade to a daily digest.
 */
export async function GET(req: Request): Promise<Response> {
  const denied = authorizeCron(req, "weekly-report");
  if (denied) return denied;

  const digest = await sendDigests("weekly");
  const report = await sendWeeklyReports();
  const ok = digest.failed === 0 && report.failed === 0;
  return Response.json({ ok, digest, report }, { status: ok ? 200 : 500 });
}
