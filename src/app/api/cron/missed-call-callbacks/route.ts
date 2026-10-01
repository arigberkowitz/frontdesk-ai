import { sweepMissedCallCallbacks } from "@/lib/agents/missed-call-callback";
import { authorizeCron } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Daily sweep for missed-call text-backs that were held because the call ended
 * outside texting hours (9am–8pm local). Most are sent straight from the Retell
 * webhook within a minute or two of the call; this only catches the overnight
 * ones, and drops anything older than MAX_CALL_AGE_HOURS.
 */
export async function GET(req: Request): Promise<Response> {
  const denied = authorizeCron(req, "missed-call-callbacks");
  if (denied) return denied;
  const summary = await sweepMissedCallCallbacks();
  return Response.json({ ok: true, ...summary });
}
