import { runWinback } from "@/lib/agents/winback";
import { authorizeCron } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Win-back sweep (Pro). Scheduled a few times across the US day; each business
 * sends only between 9 AM and 7 PM its own time and does one full pass a month.
 */
export async function GET(req: Request): Promise<Response> {
  const denied = authorizeCron(req, "winback");
  if (denied) return denied;
  const results = await runWinback();
  return Response.json({
    ok: true,
    clients: results.length,
    sent: results.reduce((n, r) => n + r.sent, 0),
    results,
  });
}
