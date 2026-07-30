import { sendDigests, sendWeeklyReports } from "@/lib/digest";
import { env } from "@/lib/env";

export const runtime = "nodejs";

/**
 * Monday cron: weekly SMS digest + the weekly owner report email. A dedicated
 * path (rather than /api/cron/digest?period=weekly) so the Vercel cron entry
 * needs no query string — if a platform strips it, the weekly run would
 * silently degrade to a daily digest.
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

  const digest = await sendDigests("weekly");
  const report = await sendWeeklyReports();
  return Response.json({ ok: true, digest, report });
}
