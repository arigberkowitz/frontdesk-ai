import { sendDigests, sendWeeklyReports, type DigestPeriod } from "@/lib/digest";
import { env } from "@/lib/env";

export const runtime = "nodejs";

/**
 * Digest cron (§E3). Trigger from Vercel Cron (or any scheduler) with
 * `Authorization: Bearer $CRON_SECRET` (or `?secret=`). Disabled until
 * CRON_SECRET is set. `?period=daily|weekly` (default daily).
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const provided =
    (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "") ||
    url.searchParams.get("secret") ||
    "";

  if (!env.CRON_SECRET || provided !== env.CRON_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const period: DigestPeriod = url.searchParams.get("period") === "weekly" ? "weekly" : "daily";
  const result = await sendDigests(period);
  // Weekly runs also send the owner report email — the retention machine.
  const report = period === "weekly" ? await sendWeeklyReports() : null;
  return Response.json({ ok: true, period, ...result, report });
}
