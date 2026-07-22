import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { appointments, type NewAppointment } from "@/db/schema";

export async function listAppointments(clientId: string) {
  return db.query.appointments.findMany({
    where: and(eq(appointments.clientId, clientId), isNull(appointments.deletedAt)),
    orderBy: [desc(appointments.startAt)],
    with: { service: true },
  });
}

/** True when an active (non-cancelled) appointment overlaps [startAt, endAt).
 *  Until per-provider scheduling exists, ANY overlap is a double-booking. */
export async function hasOverlappingAppointment(
  clientId: string,
  startAt: Date,
  endAt: Date,
): Promise<boolean> {
  const clash = await db.query.appointments.findFirst({
    where: and(
      eq(appointments.clientId, clientId),
      isNull(appointments.deletedAt),
      sql`${appointments.status} not in ('cancelled', 'no_show')`,
      // Overlap: existing.start < new.end AND existing.end > new.start
      sql`${appointments.startAt} < ${endAt}`,
      sql`coalesce(${appointments.endAt}, ${appointments.startAt} + interval '30 minutes') > ${startAt}`,
    ),
  });
  return Boolean(clash);
}

export async function createAppointment(
  clientId: string,
  input: Omit<NewAppointment, "clientId" | "id">,
) {
  const [row] = await db.insert(appointments).values({ ...input, clientId }).returning();
  if (!row) throw new Error("Failed to create appointment");
  return row;
}
