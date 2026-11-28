import { logger } from "@/lib/logger";
import { consumeAttempt } from "@/lib/rate-limit";
import { parseCspReports } from "@/lib/csp-report";

export const runtime = "nodejs";

/** Reports bigger than this are junk; a real one is under 2 KB. */
const MAX_BYTES = 8 * 1024;
/** Per warm instance, across all visitors: a broken page can't flood the logs. */
const LIMIT = 60;
const WINDOW_MS = 60_000;

/**
 * Where the browser sends Content-Security-Policy violation reports.
 *
 * Public by necessity (browsers post it with no credentials), so it is built to
 * be boring: it only ever logs one clipped, PII-free line per violation, rate
 * limits itself with a single global bucket (no per-IP key, so no IP is held),
 * and ALWAYS answers 204 whatever it was sent — a reporting problem must never
 * look like, or cause, a site problem.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const declared = Number(req.headers.get("content-length") ?? "0");
    if (declared > MAX_BYTES) return new Response(null, { status: 204 });
    if (!consumeAttempt("csp-report", LIMIT, WINDOW_MS).ok) return new Response(null, { status: 204 });

    const text = await req.text();
    if (text.length > MAX_BYTES) return new Response(null, { status: 204 });
    for (const v of parseCspReports(JSON.parse(text))) {
      logger.warn("csp.violation", { ...v });
    }
  } catch {
    // Malformed JSON, unreadable body, anything else: nothing to do.
  }
  return new Response(null, { status: 204 });
}

/** Everything else is a quiet 405 so scanners learn nothing. */
export function GET(): Response {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
