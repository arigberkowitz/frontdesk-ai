import { and, desc, eq, gte, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { calls } from "@/db/schema";
import { getCurrentDbUserSafe, userMayAccessClient } from "@/lib/auth-guard";
import { assertClientInOrg } from "@/lib/data/clients";
import { LIVE_MAX_AGE_MS, isLive } from "@/lib/live-call";
import { getCallerContext } from "@/lib/data/callers";
import { otherParty } from "@/lib/callers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Is the receptionist on a call right now?
 *
 * Polled by the portal every few seconds. Returns the open call if there is
 * one, and otherwise the most recently finished call within the last minute,
 * so the strip can turn "on a call" into "that call just ended — see it"
 * instead of vanishing.
 *
 * Session-authed with the same tenant rule as everything else; the client id
 * comes from the caller because the portal resolves it from a cookie the
 * layout already read.
 */
export async function GET(req: Request): Promise<Response> {
  const clientId = new URL(req.url).searchParams.get("client") ?? "";
  const user = await getCurrentDbUserSafe();
  if (!user || !userMayAccessClient(user, clientId)) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    await assertClientInOrg(user.orgId, clientId);
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const now = new Date();
  const since = new Date(now.getTime() - LIVE_MAX_AGE_MS);

  const open = await db.query.calls.findFirst({
    where: and(
      eq(calls.clientId, clientId),
      isNull(calls.endAt),
      isNotNull(calls.startAt),
      gte(calls.startAt, since),
    ),
    orderBy: [desc(calls.startAt)],
    columns: { id: true, fromNumber: true, toNumber: true, startAt: true, endAt: true, direction: true },
  });

  if (open && isLive(open, now)) {
    // "On a call with Sam Rivera (3rd call)" beats a bare number.
    const caller = await getCallerContext(clientId, otherParty(open), open.startAt);
    return Response.json(
      {
        live: {
          id: open.id,
          fromNumber: otherParty(open),
          startAt: open.startAt!.toISOString(),
          direction: open.direction,
          name: caller.name,
          priorCalls: caller.priorCalls,
        },
        ended: null,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  const justEnded = await db.query.calls.findFirst({
    where: and(
      eq(calls.clientId, clientId),
      isNotNull(calls.endAt),
      gte(calls.endAt, new Date(now.getTime() - 60_000)),
    ),
    orderBy: [desc(calls.endAt)],
    columns: { id: true, fromNumber: true, endAt: true, durationSec: true, outcome: true },
  });

  return Response.json(
    {
      live: null,
      ended: justEnded
        ? {
            id: justEnded.id,
            fromNumber: justEnded.fromNumber,
            endAt: justEnded.endAt!.toISOString(),
            durationSec: justEnded.durationSec,
            outcome: justEnded.outcome,
          }
        : null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
