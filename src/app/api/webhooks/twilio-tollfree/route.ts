import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { liveTollfreeDeps } from "@/lib/tollfree/deps";
import { handleTollfreeEvent, sidsFromEvents } from "@/lib/tollfree/service";

export const runtime = "nodejs";

function tokenOk(given: string | null): boolean {
  if (!env.TOLLFREE_WEBHOOK_SECRET || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(env.TOLLFREE_WEBHOOK_SECRET);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Twilio Event Streams sink for Toll-Free Verification events
 * (com.twilio.messaging.compliance.toll-free-verification.*). The URL carries
 * ?token=TOLLFREE_WEBHOOK_SECRET, and we never trust the event body: we take
 * only the verification sid and re-read its status from Twilio.
 */
export async function POST(req: Request): Promise<Response> {
  if (!env.TOLLFREE_SMS_ENABLED) return new Response("Not enabled", { status: 404 });
  if (!tokenOk(new URL(req.url).searchParams.get("token"))) return new Response("Forbidden", { status: 403 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  const deps = liveTollfreeDeps();
  const results: Array<{ sid: string; state: string | null }> = [];
  for (const sid of sidsFromEvents(body)) {
    try {
      results.push({ sid, state: await handleTollfreeEvent(deps, sid) });
    } catch (err) {
      logger.warn("webhook.tollfree.refresh_failed", { sid, error: err instanceof Error ? err.message : String(err) });
      // 500 so Event Streams retries; the daily poll is the backstop.
      return new Response("Retry", { status: 500 });
    }
  }
  return Response.json({ ok: true, results });
}
