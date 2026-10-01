import { sendDailyBriefings } from "@/lib/briefing-send";
import { authorizeCron } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Daily owner briefing. Registered several times in vercel.json (one daily
 * entry per UTC hour that is 7am somewhere in the US), because Vercel Hobby
 * only allows once-a-day crons. Each run emails only the opted-in businesses
 * for whom it's 7–10am right now, once per local day — so the slots can
 * overlap, fire late, or be re-run by hand without double-sending.
 */
export async function GET(req: Request): Promise<Response> {
  const denied = authorizeCron(req, "daily-briefing");
  if (denied) return denied;
  const result = await sendDailyBriefings();
  return Response.json({ ok: result.failed === 0, ...result }, { status: result.failed === 0 ? 200 : 500 });
}
