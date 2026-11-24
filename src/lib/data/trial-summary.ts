import "server-only";
import { and, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { appointments, businessHours, calls, leads } from "@/db/schema";
import type { TrialSummaryStats } from "@/lib/trial-summary-email";

/**
 * The numbers in the day-7 trial email, from real rows since `since` (the
 * trial start — see trial-progress.trialStart). Every query scopes by client.
 *
 *  - calls:      inbound, to a real phone number (browser test calls have no
 *                to_number), not spam and not missed.
 *  - booked:     appointments created on a call, not cancelled / no-show.
 *  - messages:   leads (messages taken) created in the window.
 *  - afterHours: of the answered calls, those the Retell webhook flagged
 *                after-hours. Null when no opening hours are saved.
 */
export async function getTrialSummaryStats(clientId: string, since: Date): Promise<TrialSummaryStats> {
  // ISO + cast: postgres-js won't bind a raw Date inside a sql`` fragment.
  const sinceTs = sql`${since.toISOString()}::timestamptz`;

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
        eq(calls.direction, "inbound"),
        isNotNull(calls.toNumber),
        sql`coalesce(${calls.startAt}, ${calls.createdAt}) >= ${sinceTs}`,
        sql`coalesce(${calls.outcome}::text, '') not in ('spam','missed')`,
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

  const [l] = await db
    .select({ messages: sql<number>`count(*)::int` })
    .from(leads)
    .where(and(eq(leads.clientId, clientId), isNull(leads.deletedAt), gte(leads.createdAt, since)));

  const [h] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(businessHours)
    .where(eq(businessHours.clientId, clientId));

  return {
    calls: c?.calls ?? 0,
    booked: b?.booked ?? 0,
    messages: l?.messages ?? 0,
    afterHours: h && h.n > 0 ? (c?.afterHours ?? 0) : null,
  };
}
