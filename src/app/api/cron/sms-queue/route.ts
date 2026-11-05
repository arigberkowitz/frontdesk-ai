import { authorizeCron } from "@/lib/cron-auth";
import { env } from "@/lib/env";
import { flushSmsQueue } from "@/lib/sms-queue";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Hourly: send texts that were held for quiet hours and whose window has ended. */
export async function GET(req: Request): Promise<Response> {
  const denied = authorizeCron(req, "sms-queue");
  if (denied) return denied;
  if (!env.OWNER_TEXTING_CONTROLS) return Response.json({ ok: true, skipped: "OWNER_TEXTING_CONTROLS off" });
  return Response.json({ ok: true, ...(await flushSmsQueue()) });
}
