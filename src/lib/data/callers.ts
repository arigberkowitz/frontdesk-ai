import "server-only";
import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { appointments, calls, leads } from "@/db/schema";
import { callerKey } from "@/lib/callers";

/**
 * Every name this business has ever captured against a phone number — from
 * bookings and from messages — most recent first, so the freshest name for a
 * number wins when the caller index is built.
 */
export async function listCallerNames(
  clientId: string,
): Promise<{ phone: string | null; name: string | null; at: Date }[]> {
  const [appts, msgs] = await Promise.all([
    db
      .select({ phone: appointments.customerPhone, name: appointments.customerName, at: appointments.createdAt })
      .from(appointments)
      .where(and(eq(appointments.clientId, clientId), isNull(appointments.deletedAt)))
      .orderBy(desc(appointments.createdAt))
      .limit(500),
    db
      .select({ phone: leads.phone, name: leads.name, at: leads.createdAt })
      .from(leads)
      .where(and(eq(leads.clientId, clientId), isNull(leads.deletedAt)))
      .orderBy(desc(leads.createdAt))
      .limit(500),
  ]);
  return [...appts, ...msgs].sort((a, b) => b.at.getTime() - a.at.getTime());
}

/**
 * What a receptionist would know the moment a number comes up: the name we
 * have for it and how many times it has called before `before`. One number,
 * two small queries — for the call page and the live strip, where loading the
 * whole log to answer "who is this?" would be silly.
 */
export async function getCallerContext(
  clientId: string,
  phone: string | null | undefined,
  before: Date | null,
): Promise<{ name: string | null; priorCalls: number }> {
  const key = callerKey(phone);
  if (!key) return { name: null, priorCalls: 0 };
  // Match on the last ten digits so formatting and country code don't split
  // one caller into several.
  const sameNumber = (col: typeof calls.fromNumber | typeof calls.toNumber) =>
    sql`right(regexp_replace(coalesce(${col}, ''), '\\D', '', 'g'), 10) = ${key}`;
  const [[row], [appt], [lead]] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(calls)
      .where(
        and(
          eq(calls.clientId, clientId),
          isNull(calls.deletedAt),
          before ? lt(calls.startAt, before) : sql`true`,
          or(
            and(eq(calls.direction, "inbound"), sameNumber(calls.fromNumber)),
            and(eq(calls.direction, "outbound"), sameNumber(calls.toNumber)),
          ),
        ),
      ),
    db
      .select({ name: appointments.customerName })
      .from(appointments)
      .where(
        and(
          eq(appointments.clientId, clientId),
          isNull(appointments.deletedAt),
          sql`right(regexp_replace(coalesce(${appointments.customerPhone}, ''), '\\D', '', 'g'), 10) = ${key}`,
          sql`coalesce(${appointments.customerName}, '') <> ''`,
        ),
      )
      .orderBy(desc(appointments.createdAt))
      .limit(1),
    db
      .select({ name: leads.name })
      .from(leads)
      .where(
        and(
          eq(leads.clientId, clientId),
          isNull(leads.deletedAt),
          sql`right(regexp_replace(coalesce(${leads.phone}, ''), '\\D', '', 'g'), 10) = ${key}`,
          sql`coalesce(${leads.name}, '') <> ''`,
        ),
      )
      .orderBy(desc(leads.createdAt))
      .limit(1),
  ]);
  return { name: appt?.name?.trim() || lead?.name?.trim() || null, priorCalls: row?.n ?? 0 };
}
