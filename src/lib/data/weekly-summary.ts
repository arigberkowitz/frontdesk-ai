import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { appointments, smsMessages, weeklySummarySends } from "@/db/schema";
import type { WeeklyActivity } from "@/lib/weekly-summary-email";

/**
 * Data for the weekly summary email. Every query is scoped by `client_id`.
 * Calls / held bookings / leads / revenue come from the existing
 * `getClientPeriodSummary`; this adds the rest.
 */

/** Kinds of automated outbound text that exist to win a missed customer back. */
const RECOVERY_KINDS = ["recovery_lead", "recovery_no_show"] as const;

export async function getWeeklyActivity(clientId: string, sinceDays = 7): Promise<WeeklyActivity> {
  const since = sql`now() - make_interval(days => ${sinceDays})`;

  const [a] = await db
    .select({
      bookingsMade: sql<number>`count(*) filter (where ${appointments.createdAt} >= ${since} and ${appointments.status} not in ('cancelled','no_show'))::int`,
      // No cancelled_at column: a cancellation is the status flip, and
      // updated_at is when it happened (cancelled rows are rarely edited again).
      cancellations: sql<number>`count(*) filter (where ${appointments.status} = 'cancelled' and ${appointments.updatedAt} >= ${since})::int`,
    })
    .from(appointments)
    .where(and(eq(appointments.clientId, clientId), sql`${appointments.deletedAt} is null`));

  // sms_messages only exists once drizzle/manual/0007 has run; a missing table
  // must not cost the business its whole summary.
  let textsReceived = 0;
  let missedRecovered = 0;
  try {
    const [t] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(smsMessages)
      .where(
        and(
          eq(smsMessages.clientId, clientId),
          eq(smsMessages.direction, "inbound"),
          sql`${smsMessages.createdAt} >= ${since}`,
        ),
      );
    textsReceived = t?.n ?? 0;

    // "Won back": a customer who wrote back (not STOP/HELP) within 14 days of
    // an automated missed-call / no-show follow-up from this business.
    const [r] = await db
      .select({ n: sql<number>`count(distinct ${smsMessages.customerPhone})::int` })
      .from(smsMessages)
      .where(
        and(
          eq(smsMessages.clientId, clientId),
          eq(smsMessages.direction, "inbound"),
          sql`${smsMessages.createdAt} >= ${since}`,
          sql`coalesce(${smsMessages.kind}, 'reply') not in ('opt_out','help')`,
          sql`exists (
            select 1 from sms_messages o
            where o.client_id = ${smsMessages.clientId}
              and o.customer_phone = ${smsMessages.customerPhone}
              and o.direction = 'outbound'
              and o.kind in (${sql.join(RECOVERY_KINDS.map((k) => sql`${k}`), sql`, `)})
              and o.created_at < ${smsMessages.createdAt}
              and o.created_at >= ${smsMessages.createdAt} - interval '14 days'
          )`,
        ),
      );
    missedRecovered = r?.n ?? 0;
  } catch {
    // Leave both at 0.
  }

  return {
    bookingsMade: a?.bookingsMade ?? 0,
    cancellations: a?.cancellations ?? 0,
    missedRecovered,
    textsReceived,
  };
}

/**
 * Claim this business's summary for `weekKey`. Returns the ledger row id when
 * this run may send, or null when the week was already sent / is being sent /
 * Only a `failed` or `skipped` (email provider not configured) row can be
 * re-claimed, so a retry after a provider error still gets the email out —
 * but nothing that was sent, or is mid-send, ever sends twice.
 */
export async function claimWeeklySummary(
  clientId: string,
  weekKey: string,
  recipient: string,
): Promise<string | null> {
  const rows = await db
    .insert(weeklySummarySends)
    .values({ clientId, weekKey, recipient, status: "sending" })
    .onConflictDoUpdate({
      target: [weeklySummarySends.clientId, weeklySummarySends.weekKey],
      set: { status: "sending", recipient, error: null, updatedAt: new Date() },
      setWhere: sql`${weeklySummarySends.status} in ('failed','skipped')`,
    })
    .returning({ id: weeklySummarySends.id });
  return rows[0]?.id ?? null;
}

export async function finishWeeklySummary(
  id: string,
  outcome: { status: "sent" | "skipped" | "failed"; error?: string | null; stats?: unknown },
): Promise<void> {
  await db
    .update(weeklySummarySends)
    .set({
      status: outcome.status,
      error: outcome.error ?? null,
      stats: (outcome.stats ?? null) as object | null,
      sentAt: outcome.status === "sent" ? new Date() : null,
    })
    .where(eq(weeklySummarySends.id, id));
}
