import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { calls, clients, leads } from "@/db/schema";

/**
 * "Why didn't these calls book?" — the unbooked calls a person could follow up on.
 * Every call in the last 14 days that didn't turn into a booking (and isn't spam),
 * bucketed by local day so the overview can answer "we got calls on the 8th but no
 * bookings — who were they?". Each row carries the caller's number to call back and,
 * when the AI took a message, the linked lead so its follow-up status shows inline.
 */
export interface FollowUpCall {
  id: string;
  date: string; // YYYY-MM-DD in the client's timezone
  startAt: Date | null;
  outcome: string | null;
  /** Best number to reach the caller — the lead's number if captured, else the caller ID. */
  phone: string | null;
  summary: string | null;
  isAfterHours: boolean;
  name: string | null;
  leadId: string | null;
  leadStatus: string | null;
}

export async function getFollowUpsByDay(
  clientId: string,
  timeZone = "America/Los_Angeles",
): Promise<FollowUpCall[]> {
  const rows = await db
    .select({
      id: calls.id,
      startAt: calls.startAt,
      date: sql<string>`to_char(date_trunc('day', ${calls.startAt} AT TIME ZONE ${timeZone}), 'YYYY-MM-DD')`,
      outcome: sql<string | null>`${calls.outcome}::text`,
      fromNumber: calls.fromNumber,
      summary: calls.summary,
      isAfterHours: calls.isAfterHours,
      leadId: leads.id,
      leadStatus: sql<string | null>`${leads.status}::text`,
      leadName: leads.name,
      leadPhone: leads.phone,
    })
    .from(calls)
    .leftJoin(leads, and(eq(leads.callId, calls.id), isNull(leads.deletedAt)))
    .where(
      and(
        eq(calls.clientId, clientId),
        isNull(calls.deletedAt),
        sql`${calls.startAt} >= now() - interval '13 days'`,
        // Anything that booked is a win; spam isn't worth a callback.
        sql`(${calls.outcome} is null or ${calls.outcome} not in ('booked', 'spam'))`,
      ),
    )
    .orderBy(desc(calls.startAt));

  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    startAt: r.startAt,
    outcome: r.outcome,
    phone: r.leadPhone ?? r.fromNumber,
    summary: r.summary,
    isAfterHours: r.isAfterHours,
    name: r.leadName,
    leadId: r.leadId,
    leadStatus: r.leadStatus,
  }));
}

/** Convenience for callers that have the id but not the timezone. */
export async function getFollowUpsForClient(clientId: string): Promise<FollowUpCall[]> {
  const [row] = await db
    .select({ tz: clients.timezone })
    .from(clients)
    .where(eq(clients.id, clientId));
  return getFollowUpsByDay(clientId, row?.tz ?? "America/Los_Angeles");
}
