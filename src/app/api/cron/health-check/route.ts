import { runHealthCheck } from "@/lib/health-check";
import { authorizeCron } from "@/lib/cron-auth";

export const runtime = "nodejs";
// Reading a day of calls and running transcript analysis can outlive the
// default 10s ceiling; same allowance as the other sweeping crons.
export const maxDuration = 300;

/**
 * Morning health check — the watcher for silent failures. Reads failed texts,
 * stuck webhooks, unhealthy calls, and dying trials, and emails the operator
 * ONLY when something needs attention (plus a Monday all-clear as proof of
 * life). Same auth as the other crons: `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: Request): Promise<Response> {
  const denied = authorizeCron(req, "health-check");
  if (denied) return denied;

  const result = await runHealthCheck();
  const ok = !result.emailError;
  return Response.json(
    {
      ok,
      issues: result.issues.length,
      critical: result.issues.filter((i) => i.severity === "critical").length,
      emailed: result.emailed,
      ...(result.emailError ? { emailError: result.emailError } : {}),
    },
    { status: ok ? 200 : 500 },
  );
}
