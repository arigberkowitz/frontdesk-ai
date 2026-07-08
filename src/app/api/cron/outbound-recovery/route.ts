import { runOutboundRecovery } from "@/lib/agents/recovery";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Agent #5 cron — outbound recovery (cold leads + no-shows). Scheduled for
 * mid-morning US time; the agent itself enforces per-client local quiet hours.
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

  const results = await runOutboundRecovery();
  return Response.json({
    ok: true,
    clients: results.length,
    sent: results.reduce((n, r) => n + r.sent, 0),
    results,
  });
}
