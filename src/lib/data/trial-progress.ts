import "server-only";
import { and, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { appointments, calls, clients } from "@/db/schema";
import { trialStart, type TrialProgress } from "@/lib/trial-progress";

/**
 * What the AI has done since this business's free trial started, from real
 * rows: calls answered (spam excluded) and appointments it booked on a call
 * (linked to a call, not cancelled or a no-show — appointments the owner typed
 * in by hand aren't the AI's work). Null when there's no trial clock.
 */
export async function getTrialProgress(clientId: string): Promise<TrialProgress | null> {
  const client = await db.query.clients.findFirst({
    where: and(eq(clients.id, clientId), isNull(clients.deletedAt)),
    columns: { trialEndsAt: true, createdAt: true },
  });
  if (!client?.trialEndsAt) return null;
  const since = trialStart(client.trialEndsAt, client.createdAt);

  const [c] = await db
    .select({
      calls: sql<number>`count(*)::int`,
      afterHours: sql<number>`count(*) filter (where ${calls.isAfterHours})::int`,
    })
    .from(calls)
    .where(
      and(
        eq(calls.clientId, clientId),
        isNull(calls.deletedAt),
        // ISO + cast: postgres-js won't bind a raw Date inside a sql`` fragment.
        sql`coalesce(${calls.startAt}, ${calls.createdAt}) >= ${since.toISOString()}::timestamptz`,
        sql`${calls.outcome} is distinct from 'spam'`,
      ),
    );
  const [b] = await db
    .select({ booked: sql<number>`count(*)::int` })
    .from(appointments)
    .where(
      and(
        eq(appointments.clientId, clientId),
        isNull(appointments.deletedAt),
        isNotNull(appointments.callId),
        gte(appointments.createdAt, since),
        sql`${appointments.status} not in ('cancelled','no_show')`,
      ),
    );
  return { calls: c?.calls ?? 0, afterHours: c?.afterHours ?? 0, booked: b?.booked ?? 0, since };
}
