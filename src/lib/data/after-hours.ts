import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { appointments, businessHours, calls, services } from "@/db/schema";
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
 *  - value:    what those booked calls are worth at the owner's listed
 *              prices (services.price_cents). A booked call counts as priced
 *              only when it has at least one live appointment and every live
 *              appointment on it has a service with a price set. A booked
 *              call with no appointment row, or with an unpriced service, is
 *              left out of the sum and shows up as "2 of 3 had a listed
 *              price". Nothing is averaged or defaulted.
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

  const baseWhere = and(
    eq(calls.clientId, clientId),
    isNull(calls.deletedAt),
    eq(calls.direction, "inbound"),
    eq(calls.isAfterHours, true),
    sql`coalesce(${calls.outcome}::text, '') not in ('spam','missed')`,
  );

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
      and(baseWhere, sql`${calls.startAt} >= now() - interval '14 days'`),
    );

  // One row per booked after-hours call this week, with its live
  // appointments' listed prices. Unpriced services stay null — never filled in.
  const perCall = await db
    .select({
      appts: sql<number>`count(${appointments.id})::int`,
      pricedAppts: sql<number>`count(${services.priceCents})::int`,
      cents: sql<number>`coalesce(sum(${services.priceCents}), 0)::int`,
      floor: sql<boolean>`coalesce(bool_or(${services.priceFrom} or ${services.priceMaxCents} is not null), false)`,
    })
    .from(calls)
    .leftJoin(
      appointments,
      and(
        eq(appointments.callId, calls.id),
        eq(appointments.clientId, calls.clientId),
        isNull(appointments.deletedAt),
        sql`${appointments.status} not in ('cancelled','no_show')`,
      ),
    )
    .leftJoin(services, and(eq(services.id, appointments.serviceId), eq(services.clientId, calls.clientId)))
    .where(and(baseWhere, thisWeek, booked))
    .groupBy(calls.id);

  let priced = 0;
  let cents = 0;
  let atLeast = false;
  for (const c of perCall) {
    if (c.appts > 0 && c.pricedAppts === c.appts) {
      priced += 1;
      cents += Number(c.cents);
      if (c.floor) atLeast = true;
    }
  }

  return {
    answered: r?.answered ?? 0,
    booked: r?.booked ?? 0,
    messages: r?.messages ?? 0,
    prior: { answered: r?.priorAnswered ?? 0, booked: r?.priorBooked ?? 0 },
    value: { priced, cents, atLeast },
  };
}
