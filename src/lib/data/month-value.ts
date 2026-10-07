import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { appointments, callCallbacks, calls, services, smsMessages } from "@/db/schema";
import { AI_REPLY_KIND } from "@/lib/sms-ai/rules";
import type { MonthValueStats } from "@/lib/month-value";

/**
 * "What Frontdesk did for you this month" — the Overview value card. The
 * month is the BUSINESS's calendar month (its own timezone), not UTC.
 *
 * Revenue uses the same rule as the "Revenue captured" tile and the operator
 * dashboard (src/lib/data/metrics.ts): each appointment at the price of the
 * service actually booked, counted only once the appointment has happened,
 * cancelled / no-shows excluded. Every query is scoped by client_id; each one
 * fails soft to null so a missing table (e.g. before a migration) shows "—",
 * never a made-up 0.
 */
export async function getMonthValue(clientId: string, timeZone: string): Promise<MonthValueStats> {
  // Local midnight on the 1st, as an instant.
  const monthStart = sql`(date_trunc('month', now() at time zone ${timeZone}) at time zone ${timeZone})`;
  const monthEnd = sql`((date_trunc('month', now() at time zone ${timeZone}) + interval '1 month') at time zone ${timeZone})`;
  // Aliased so the correlated subqueries below can name the outer row
  // unambiguously (an unqualified column there would bind to the inner table).
  const cc = alias(callCallbacks, "cc");
  const soft = <T,>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

  const [revenue, callStats, recovery, texts] = await Promise.all([
    soft(
      db
        .select({
          earnedCents: sql<number>`coalesce(sum(${services.priceCents}) filter (where ${appointments.startAt} <= now()), 0)::int`,
          completed: sql<number>`count(*) filter (where ${appointments.startAt} <= now())::int`,
          // Happened, but the service has no price — can't be valued honestly.
          unpriced: sql<number>`count(*) filter (where ${appointments.startAt} <= now() and ${services.priceCents} is null)::int`,
          upcomingCents: sql<number>`coalesce(sum(${services.priceCents}) filter (where ${appointments.startAt} > now()), 0)::int`,
          upcoming: sql<number>`count(*) filter (where ${appointments.startAt} > now())::int`,
        })
        .from(appointments)
        .leftJoin(services, eq(appointments.serviceId, services.id))
        .where(
          and(
            eq(appointments.clientId, clientId),
            isNull(appointments.deletedAt),
            sql`${appointments.status} not in ('cancelled','no_show')`,
            sql`${appointments.startAt} >= ${monthStart}`,
            sql`${appointments.startAt} < ${monthEnd}`,
          ),
        )
        .then((r) => r[0] ?? null),
    ),
    soft(
      db
        .select({
          calls: sql<number>`count(*)::int`,
          // Spam isn't a save, so it doesn't count toward after-hours answered.
          afterHours: sql<number>`count(*) filter (where ${calls.isAfterHours} and coalesce(${calls.outcome}::text, '') <> 'spam')::int`,
        })
        .from(calls)
        .where(
          and(
            eq(calls.clientId, clientId),
            isNull(calls.deletedAt),
            eq(calls.direction, "inbound"),
            sql`${calls.startAt} >= ${monthStart}`,
          ),
        )
        .then((r) => r[0] ?? null),
    ),
    // A missed / dropped call counts as RECOVERED only when, after our
    // text-back went out, that caller booked, called again or texted back
    // (a STOP doesn't count). Sent but no response = followed up, not won.
    soft(
      db
        .select({
          sent: sql<number>`count(*)::int`,
          recovered: sql<number>`count(*) filter (where
            exists (
              select 1 from appointments a
              where a.client_id = cc.client_id
                and a.deleted_at is null
                and a.status not in ('cancelled','no_show')
                and a.created_at >= cc.sent_at
                and right(regexp_replace(coalesce(a.customer_phone, ''), '[^0-9]', '', 'g'), 10) = right(cc.customer_phone, 10)
            )
            or exists (
              select 1 from calls c
              where c.client_id = cc.client_id
                and c.deleted_at is null
                and c.direction = 'inbound'
                and c.start_at > cc.sent_at
                and right(regexp_replace(coalesce(c.from_number, ''), '[^0-9]', '', 'g'), 10) = right(cc.customer_phone, 10)
            )
            or exists (
              select 1 from sms_messages m
              where m.client_id = cc.client_id
                and m.direction = 'inbound'
                and m.kind = 'reply'
                and m.created_at > cc.sent_at
                and right(m.customer_phone, 10) = right(cc.customer_phone, 10)
            )
          )::int`,
        })
        .from(cc)
        .where(and(eq(cc.clientId, clientId), eq(cc.status, "sent"), sql`${cc.sentAt} >= ${monthStart}`))
        .then((r) => r[0] ?? null),
    ),
    soft(
      db
        .select({
          aiTexts: sql<number>`count(*)::int`,
          conversations: sql<number>`count(distinct ${smsMessages.customerPhone})::int`,
        })
        .from(smsMessages)
        .where(
          and(
            eq(smsMessages.clientId, clientId),
            eq(smsMessages.direction, "outbound"),
            eq(smsMessages.kind, AI_REPLY_KIND),
            sql`${smsMessages.status} <> 'failed'`,
            sql`${smsMessages.createdAt} >= ${monthStart}`,
          ),
        )
        .then((r) => r[0] ?? null),
    ),
  ]);

  return { revenue, calls: callStats, recovery, texts };
}
