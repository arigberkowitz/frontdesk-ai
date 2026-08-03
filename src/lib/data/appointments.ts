import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { appointments, type Appointment, type NewAppointment } from "@/db/schema";
import { normalizePhone } from "./sms-optouts";

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

  // ISO strings in raw fragments — postgres-js can't serialize Date instances
  // inside sql`` params.
  const startIso = startAt.toISOString();
  const endIso = endAt.toISOString();
  const overlapping = await db.query.appointments.findMany({
    where: and(
      eq(appointments.clientId, clientId),
      isNull(appointments.deletedAt),
      sql`${appointments.status} not in ('cancelled', 'no_show')`,
      // Overlap: existing.start < new.end AND existing.end > new.start
      sql`${appointments.startAt} < ${endIso}::timestamptz`,
      sql`coalesce(${appointments.endAt}, ${appointments.startAt} + interval '30 minutes') > ${startIso}::timestamptz`,
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

/**
 * Insert, but only if the slot is still free — checked and taken atomically.
 *
 * Checking availability and then inserting are two round trips, and two callers
 * can sit in the gap between them. Both are told the 2 o'clock is theirs; the
 * business finds out when two people arrive. Rare and silent, which is exactly
 * the combination nobody believes until it happens.
 *
 * A transaction-scoped advisory lock keyed on the client serializes bookings
 * for one business — the check and the insert become one indivisible step —
 * while every other business carries on unblocked. No schema change required,
 * which matters: the textbook fix is a gist exclusion constraint, and that
 * can't go on this table without a migration nobody can run mid-call.
 *
 * Returns null when the slot went while we were looking at it.
 */
export async function reserveAppointment(
  clientId: string,
  input: Omit<NewAppointment, "clientId" | "id">,
  service?: { id: string; providerCount?: number | null } | null,
): Promise<Appointment | null> {
  const startAt = input.startAt instanceof Date ? input.startAt : new Date(input.startAt as string);
  const endAt = input.endAt
    ? input.endAt instanceof Date
      ? input.endAt
      : new Date(input.endAt as string)
    : new Date(startAt.getTime() + 30 * 60_000);
  const startIso = startAt.toISOString();
  const endIso = endAt.toISOString();
  const capacity = Math.max(1, service?.providerCount ?? 1);

  return db.transaction(async (tx) => {
    // Held until this transaction ends, whether it commits or rolls back.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${clientId}))`);

    const overlapping = await tx
      .select({ serviceId: appointments.serviceId, providerId: appointments.providerId })
      .from(appointments)
      .where(
        and(
          eq(appointments.clientId, clientId),
          isNull(appointments.deletedAt),
          sql`${appointments.status} not in ('cancelled', 'no_show')`,
          sql`${appointments.startAt} < ${endIso}::timestamptz`,
          sql`coalesce(${appointments.endAt}, ${appointments.startAt} + interval '30 minutes') > ${startIso}::timestamptz`,
        ),
      );

    if (input.providerId) {
      // Staff mode: this person, at this time, once.
      if (overlapping.some((a) => a.providerId === input.providerId)) return null;
    } else if (overlapping.length > 0) {
      const sameService = service
        ? overlapping.filter((a) => a.serviceId === service.id).length
        : overlapping.length;
      if (sameService >= capacity) return null;
      // Solo capacity: any overlap at all is a clash, same rule as the
      // pre-flight check.
      if (capacity <= 1) return null;
    }

    const [row] = await tx.insert(appointments).values({ ...input, clientId }).returning();
    if (!row) throw new Error("Failed to create appointment");
    return row;
  });
}

/**
 * Upcoming active appointments whose customer phone matches the given number
 * (compared on digits, tolerating +1/formatting differences). Powers the
 * cancel-by-phone flow.
 */
export async function findUpcomingAppointmentsByPhone(
  clientId: string,
  phone: string,
): Promise<(Appointment & { service: { name: string } | null })[]> {
  const wanted = normalizePhone(phone);
  if (!wanted) return [];
  const upcoming = await db.query.appointments.findMany({
    where: and(
      eq(appointments.clientId, clientId),
      isNull(appointments.deletedAt),
      sql`${appointments.status} not in ('cancelled', 'no_show')`,
      sql`${appointments.startAt} > now()`,
    ),
    orderBy: [appointments.startAt],
    with: { service: { columns: { name: true } } },
    limit: 200,
  });
  return upcoming.filter(
    (a) => a.customerPhone && normalizePhone(a.customerPhone) === wanted,
  );
}

/** Mark an appointment cancelled (tenant-scoped). Returns the row, or null if not found. */
export async function cancelAppointment(
  clientId: string,
  appointmentId: string,
): Promise<Appointment | null> {
  const [row] = await db
    .update(appointments)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(appointments.id, appointmentId),
        eq(appointments.clientId, clientId),
        isNull(appointments.deletedAt),
      ),
    )
    .returning();
  return row ?? null;
}
