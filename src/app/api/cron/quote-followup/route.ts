import { authorizeCron } from "@/lib/cron-auth";
import { sendQuoteFollowups } from "@/lib/revenue/quote-followup-send";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Quote follow-up texts (opt-in per business, off by default). Registered every
 * two hours across the US daytime in vercel.json; each run only texts people
 * whose business is inside its own 9am–7pm window, and every send is claimed in
 * a ledger first, so overlapping or repeated runs can't double-send.
 */
export async function GET(req: Request): Promise<Response> {
  const denied = authorizeCron(req, "quote-followup");
  if (denied) return denied;
  const result = await sendQuoteFollowups();
  return Response.json({ ok: result.failed === 0, ...result }, { status: result.failed === 0 ? 200 : 500 });
}
