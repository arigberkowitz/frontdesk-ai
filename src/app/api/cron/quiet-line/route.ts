import { checkQuietLines } from "@/lib/quiet-line";
import { env } from "@/lib/env";

export const runtime = "nodejs";

/**
 * Quiet-line check. Runs mid-morning so an alert lands while someone can still
 * pick up a phone and dial *72 — not at 3am when it'll be buried by breakfast.
 * Same auth as the other crons: `Authorization: Bearer $CRON_SECRET`.
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

  const result = await checkQuietLines();
  return Response.json({ ok: true, ...result });
}
