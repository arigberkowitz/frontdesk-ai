import { runReviewRequests } from "@/lib/agents/review-requests";
import { authorizeCron } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Review-request sweep, a few times a day.
 *
 * Runs every couple of hours across the US day so the owner's delay (default
 * 2 hours after the visit ends) means roughly that. The agent enforces each
 * business's own 9 AM–7 PM local window and the Pro plan on top.
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
