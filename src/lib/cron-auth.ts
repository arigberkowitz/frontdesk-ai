import "server-only";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * One authorization rule for every scheduled job, in one place.
 *
 * Two things were wrong with the copy in each route. It accepted the secret in
 * `?secret=`, and query strings are the one part of a URL that gets written
 * down everywhere — access logs, proxy logs, error reports, a screenshot of a
 * browser bar. And it compared with `!==`, which returns as soon as two bytes
 * differ and so leaks the answer a character at a time to anyone patient enough
 * to measure.
 *
 * Vercel Cron sends `Authorization: Bearer …`, which is all we need.
 */
export function authorizeCron(req: Request, route: string): Response | null {
  if (!env.CRON_SECRET) {
    logger.error("cron.not_configured", {
      route,
      detail: "CRON_SECRET is unset, so every scheduled job is refusing to run.",
    });
    return new Response("Cron not configured", { status: 503 });
  }

  const provided = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!provided || !constantTimeEquals(provided, env.CRON_SECRET)) {
    logger.warn("cron.unauthorized", { route, hadHeader: Boolean(provided) });
    return new Response("Unauthorized", { status: 401 });
  }
  return null;
}

function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  // Lengths differ → not equal, and comparing them isn't the leak that matters;
  // timingSafeEqual simply requires equal lengths.
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
