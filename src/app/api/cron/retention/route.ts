import { runRetention } from "@/lib/retention";
import { authorizeCron } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Retention purge cron — makes the privacy policy's deletion promise true.
 * Daily; almost every run deletes nothing and that's the correct outcome.
 * Same auth as the other crons: `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: Request): Promise<Response> {
  const denied = authorizeCron(req, "retention");
  if (denied) return denied;

  const result = await runRetention();
  return Response.json({
    ok: true,
    clientsPurged: result.clientsPurged,
    webhookPayloadsCleared: result.webhookPayloadsCleared,
  });
}
