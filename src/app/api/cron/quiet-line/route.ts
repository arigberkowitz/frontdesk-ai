import { checkQuietLines } from "@/lib/quiet-line";
import { authorizeCron } from "@/lib/cron-auth";

export const runtime = "nodejs";
// Sweeping every client takes longer than the default 10s ceiling, and hitting
// it kills the run partway through — some businesses emailed, some silently
// not, differently each night.
export const maxDuration = 300;

/**
 * Quiet-line check. Runs mid-morning so an alert lands while someone can still
 * pick up a phone and dial *72 — not at 3am when it'll be buried by breakfast.
 * Same auth as the other crons: `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: Request): Promise<Response> {
  const denied = authorizeCron(req, "quiet-line");
  if (denied) return denied;

  const result = await checkQuietLines();
  return Response.json({ ok: result.failed === 0, ...result }, {
    status: result.failed === 0 ? 200 : 500,
  });
}
