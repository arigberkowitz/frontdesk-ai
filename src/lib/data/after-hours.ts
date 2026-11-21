import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { businessHours, calls } from "@/db/schema";
import type { AfterHoursWeek } from "@/lib/after-hours-copy";

/**
 * "While you were closed": calls the AI picked up outside opening hours over
 * the last 7 days, and what came of them, plus the 7 days before for a
 * comparison line. Scoped by `client_id`.
 *
 * After-hours is the `calls.is_after_hours` flag the Retell webhook stamps on
 * every call with `isAfterHours()` (src/lib/hours-util.ts), in the business's
 * own time zone against its saved hours. Nothing is recomputed here.
 *
 *  - answered: inbound, flagged after-hours, not spam and not missed.
 *  - booked:   of those, the call's outcome is `booked` or it created an
 *              appointment that isn't cancelled / no-show.
 *  - messages: of the rest (never double-counted with booked), the outcome is
 *              `lead` or the call created a lead.
 *
 * Returns null when the business has no opening hours saved: without hours no
 * call is ever flagged, and "0 calls while you were closed" would be a lie.
 */
export async function getAfterHoursWeek(clientId: string): Promise<AfterHoursWeek | null> {
  const [hours] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(businessHours)
    .where(eq(businessHours.clientId, clientId));
  if (!hours || hours.n === 0) return null;

  const thisWeek = sql`${calls.startAt} >= now() - interval '7 days'`;
  const lastWeek = sql`${calls.startAt} >= now() - interval '14 days' and ${calls.startAt} < now() - interval '7 days'`;
  const booked = sql`(${calls.outcome} = 'booked' or exists (
    select 1 from appointments a
    where a.call_id = ${calls.id} and a.client_id = ${calls.clientId}
      and a.deleted_at is null and a.status not in ('cancelled','no_show')
  ))`;
  const message = sql`(not ${booked} and (${calls.outcome} = 'lead' or exists (
    select 1 from leads l
    where l.call_id = ${calls.id} and l.client_id = ${calls.clientId} and l.deleted_at is null
  )))`;

  const [r] = await db
    .select({
      answered: sql<number>`count(*) filter (where ${thisWeek})::int`,
      booked: sql<number>`count(*) filter (where ${thisWeek} and ${booked})::int`,
      messages: sql<number>`count(*) filter (where ${thisWeek} and ${message})::int`,
      priorAnswered: sql<number>`count(*) filter (where ${lastWeek})::int`,
      priorBooked: sql<number>`count(*) filter (where ${lastWeek} and ${booked})::int`,
    })
    .from(calls)
    .where(
      and(
        eq(calls.clientId, clientId),
        isNull(calls.deletedAt),
        eq(calls.direction, "inbound"),
        eq(calls.isAfterHours, true),
        sql`coalesce(${calls.outcome}::text, '') not in ('spam','missed')`,
        sql`${calls.startAt} >= now() - interval '14 days'`,
      ),
    );

  return {
    answered: r?.answered ?? 0,
    booked: r?.booked ?? 0,
    messages: r?.messages ?? 0,
    prior: { answered: r?.priorAnswered ?? 0, booked: r?.priorBooked ?? 0 },
  };
}
