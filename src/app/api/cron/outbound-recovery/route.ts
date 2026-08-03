import { runOutboundRecovery } from "@/lib/agents/recovery";
import { authorizeCron } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Agent #5 cron — outbound recovery (cold leads + no-shows). Scheduled for
 * mid-morning US time; the agent itself enforces per-client local quiet hours.
 */
export async function GET(req: Request): Promise<Response> {
  const denied = authorizeCron(req, "outbound-recovery");
  if (denied) return denied;

  const results = await runOutboundRecovery();
  return Response.json({
    ok: true,
    clients: results.length,
    sent: results.reduce((n, r) => n + r.sent, 0),
    results,
  });
}
