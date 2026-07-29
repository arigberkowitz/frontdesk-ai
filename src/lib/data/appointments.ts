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

/**
 * Double-booking guard, capacity-aware. A new booking for a service conflicts
 * when the SAME service already has as many overlapping active appointments as
 * it has people providing it (services.providerCount, default 1 = solo). With
 * capacity 1 we also block overlaps with OTHER services — a solo operator
 * can't be in two rooms at once. With capacity > 1 (a team), other services
 * are assumed to have their own staff and don't block.
 */
export async function hasOverlappingAppointment(
  clientId: string,
  startAt: Date,
  endAt: Date,
  service?: { id: string; providerCount?: number | null } | null,
): Promise<boolean> {
  const capacity = Math.max(1, service?.providerCount ?? 1);

  const overlapping = await db.query.appointments.findMany({
    where: and(
      eq(appointments.clientId, clientId),
      isNull(appointments.deletedAt),
      sql`${appointments.status} not in ('cancelled', 'no_show')`,
      // Overlap: existing.start < new.end AND existing.end > new.start
      sql`${appointments.startAt} < ${endAt}`,
      sql`coalesce(${appointments.endAt}, ${appointments.startAt} + interval '30 minutes') > ${startAt}`,
    ),
    columns: { serviceId: true },
  });
  if (overlapping.length === 0) return false;

  const sameService = service
    ? overlapping.filter((a) => a.serviceId === service.id).length
    : overlapping.length;
  if (sameService >= capacity) return true;

  // Solo capacity keeps the old strict rule: any overlap at all is a clash.
  if (capacity <= 1) return overlapping.length > 0;

  return false;
}

export async function createAppointment(
  clientId: string,
  input: Omit<NewAppointment, "clientId" | "id">,
) {
  const [row] = await db.insert(appointments).values({ ...input, clientId }).returning();
  if (!row) throw new Error("Failed to create appointment");
  return row;
}
