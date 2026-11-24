import { authorizeCron } from "@/lib/cron-auth";
import { sendMorningUnbookedTexts } from "@/lib/morning-unbooked-send";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Morning owner text: last night's after-hours callers who didn't book.
 * Registered once per UTC hour that is 8am somewhere in the US (vercel.json),
 * because Hobby crons are once-a-day. Each run only texts opted-in businesses
 * for whom it's 8–11am right now, once per local day, and only when there's
 * someone to list — so slots can overlap, fire late, or be re-run safely.
 */
export async function GET(req: Request): Promise<Response> {
  const denied = authorizeCron(req, "morning-unbooked");
  if (denied) return denied;
  const result = await sendMorningUnbookedTexts();
  return Response.json({ ok: result.failed === 0, ...result }, { status: result.failed === 0 ? 200 : 500 });
}
