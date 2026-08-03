import { runQaReview } from "@/lib/agents/qa";
import { authorizeCron } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Agent #3 cron — QA / supervisor batch grading. Scheduled shortly before the
 * nightly improvement loop so fresh flags feed it. Same auth as other crons.
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const denied = authorizeCron(req, "qa-review");
  if (denied) return denied;

  const hours = Math.min(24 * 7, Math.max(1, Number(url.searchParams.get("hours")) || 24));
  const results = await runQaReview(hours);
  return Response.json({
    ok: true,
    hours,
    clients: results.length,
    graded: results.reduce((n, r) => n + r.graded, 0),
    flagged: results.reduce((n, r) => n + r.flagged, 0),
    results,
  });
}
