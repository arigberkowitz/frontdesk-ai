import { runNightlyImprovement } from "@/lib/agents/improve";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Agent #1 cron — the nightly self-improvement loop. Trigger from Vercel Cron
 * with `Authorization: Bearer $CRON_SECRET` (or `?secret=`). `?hours=` widens
 * the lookback window (default 24) for backfills.
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

  const hours = Math.min(24 * 7, Math.max(1, Number(url.searchParams.get("hours")) || 24));
  const results = await runNightlyImprovement(hours);
  return Response.json({
    ok: true,
    hours,
    clients: results.length,
    suggested: results.reduce((n, r) => n + r.kept, 0),
    results,
  });
}
