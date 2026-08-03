import { sendDigests, sendWeeklyReports, type DigestPeriod } from "@/lib/digest";
import { authorizeCron } from "@/lib/cron-auth";

export const runtime = "nodejs";
// Sweeping every client takes longer than the default 10s ceiling, and hitting
// it kills the run partway through — some businesses emailed, some silently
// not, differently each night.
export const maxDuration = 300;

/**
 * Digest cron (§E3). Trigger from Vercel Cron (or any scheduler) with
 * `Authorization: Bearer $CRON_SECRET`. Disabled until
 * CRON_SECRET is set. `?period=daily|weekly` (default daily).
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const denied = authorizeCron(req, "digest");
  if (denied) return denied;

  const period: DigestPeriod = url.searchParams.get("period") === "weekly" ? "weekly" : "daily";
  const result = await sendDigests(period);
  // Weekly runs also send the owner report email — the retention machine.
  const report = period === "weekly" ? await sendWeeklyReports() : null;
  // `ok` used to be the literal true, so a night where every client failed and
  // a night where everything worked were the same green tick in the cron log.
  const ok = result.failed === 0 && (report?.failed ?? 0) === 0;
  return Response.json({ ok, period, ...result, report }, { status: ok ? 200 : 500 });
}
