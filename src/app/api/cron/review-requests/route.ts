import { runReviewRequests } from "@/lib/agents/review-requests";
import { authorizeCron } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Daily review-request sweep.
 *
 * Scheduled late afternoon UTC so it lands in the US afternoon — the agent
 * enforces each client's own 9am–7pm local window on top, and only picks up
 * visits that ended at least three hours ago.
 */
export async function GET(req: Request): Promise<Response> {
  const denied = authorizeCron(req, "review-requests");
  if (denied) return denied;

  const results = await runReviewRequests();
  return Response.json({
    ok: true,
    clients: results.length,
    sent: results.reduce((n, r) => n + r.sent, 0),
    results,
  });
}
