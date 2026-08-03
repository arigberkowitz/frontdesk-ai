import { runNightlyImprovement } from "@/lib/agents/improve";
import { authorizeCron } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Agent #1 cron — the nightly self-improvement loop. Trigger from Vercel Cron
 * with `Authorization: Bearer $CRON_SECRET`. `?hours=` widens
 * the lookback window (default 24) for backfills.
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const denied = authorizeCron(req, "nightly-improve");
  if (denied) return denied;

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
