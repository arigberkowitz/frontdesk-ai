import { runRecall } from "@/lib/agents/recall";
import { authorizeCron } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Daily recall sweep. The agent enforces each client's local daytime window. */
export async function GET(req: Request): Promise<Response> {
  const denied = authorizeCron(req, "recall");
  if (denied) return denied;

  const results = await runRecall();
  return Response.json({
    ok: true,
    clients: results.length,
    sent: results.reduce((n, r) => n + r.sent, 0),
    results,
  });
}
