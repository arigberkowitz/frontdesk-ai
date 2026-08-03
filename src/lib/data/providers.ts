import "server-only";
import { and, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { appointments, providers, services, type Provider } from "@/db/schema";
import { overlapsBlock, type AvailabilityBlockLite } from "@/lib/booking-window";

export async function listProviders(clientId: string): Promise<Provider[]> {
  return db.query.providers.findMany({
    where: and(eq(providers.clientId, clientId), isNull(providers.deletedAt)),
    orderBy: (p, { asc }) => [asc(p.name)],
  });
}

/**
 * A provider is free at [startAt, endAt) when they have no overlapping active
 * appointment AND aren't on leave.
 *
 * The leave half is new. Availability blocks carrying a providerId are one
 * person's time off, but nothing consulted them when assigning work — so the
 * receptionist cheerfully booked the hygienist who was on holiday, because her
 * calendar was, of course, empty.
 */
export async function findFreeProvider(
  clientId: string,
  startAt: Date,
  endAt: Date,
  preferredName?: string | null,
  leave?: { blocks: AvailabilityBlockLite[]; timezone: string },
): Promise<Provider | null> {
  let team = (await listProviders(clientId)).filter((p) => p.isActive);
  if (team.length === 0) return null;

  if (leave?.blocks.length) {
    team = team.filter(
      (p) =>
        !overlapsBlock(
          leave.blocks.filter((b) => b.providerId === p.id),
          leave.timezone,
          startAt.getTime(),
          endAt.getTime(),
        ),
    );
    if (team.length === 0) return null;
  }

  // Raw fragments get ISO strings, not Date objects — postgres-js can't
  // serialize Dates inside sql`` template params (ERR_INVALID_ARG_TYPE).
  const startIso = startAt.toISOString();
  const endIso = endAt.toISOString();
  const busy = await db.query.appointments.findMany({
    where: and(
      eq(appointments.clientId, clientId),
      isNull(appointments.deletedAt),
      sql`${appointments.status} not in ('cancelled', 'no_show')`,
      sql`${appointments.startAt} < ${endIso}::timestamptz`,
      sql`coalesce(${appointments.endAt}, ${appointments.startAt} + interval '30 minutes') > ${startIso}::timestamptz`,
    ),
    columns: { providerId: true },
  });
  const busyIds = new Set(busy.map((b) => b.providerId).filter(Boolean));

  const wanted = preferredName?.trim().toLowerCase();
  if (wanted) {
    const match = team.find((p) => p.name.toLowerCase().includes(wanted));
    // Caller asked for someone specific: only that person counts.
    return match && !busyIds.has(match.id) ? match : null;
  }
  return team.find((p) => !busyIds.has(p.id)) ?? null;
}

/** Whether one specific provider has no overlapping active appointment in [startAt, endAt). */
export async function isProviderFree(
  clientId: string,
  providerId: string,
  startAt: Date,
  endAt: Date,
): Promise<boolean> {
  const startIso = startAt.toISOString();
  const endIso = endAt.toISOString();
  const clash = await db.query.appointments.findFirst({
    where: and(
      eq(appointments.clientId, clientId),
      eq(appointments.providerId, providerId),
      isNull(appointments.deletedAt),
      sql`${appointments.status} not in ('cancelled', 'no_show')`,
      sql`${appointments.startAt} < ${endIso}::timestamptz`,
      sql`coalesce(${appointments.endAt}, ${appointments.startAt} + interval '30 minutes') > ${startIso}::timestamptz`,
    ),
    columns: { id: true },
  });
  return !clash;
}

export interface ProviderDayStats {
  provider: Provider;
  todayCount: number;
  totalBookings: number;
  earnedRevenueCents: number;
}

/** Per-person workload + production (revenue counts only after the appointment happened). */
export async function getProviderStats(
  clientId: string,
  dayStart: Date,
  dayEnd: Date,
): Promise<ProviderDayStats[]> {
  const team = await listProviders(clientId);
  const dayStartIso = dayStart.toISOString();
  const dayEndIso = dayEnd.toISOString();
  const rows = await db
    .select({
      providerId: appointments.providerId,
      today: sql<number>`count(*) filter (where ${appointments.startAt} >= ${dayStartIso}::timestamptz and ${appointments.startAt} < ${dayEndIso}::timestamptz)::int`,
      total: sql<number>`count(*)::int`,
      earned: sql<number>`coalesce(sum(${services.priceCents}) filter (where ${appointments.startAt} <= now()), 0)::int`,
    })
    .from(appointments)
    .leftJoin(services, eq(appointments.serviceId, services.id))
    .where(
      and(
        eq(appointments.clientId, clientId),
        isNull(appointments.deletedAt),
        sql`${appointments.status} not in ('cancelled', 'no_show')`,
      ),
    )
    .groupBy(appointments.providerId);

  const byId = new Map(rows.map((r) => [r.providerId, r]));
  return team.map((provider) => {
    const r = byId.get(provider.id);
    return {
      provider,
      todayCount: r?.today ?? 0,
      totalBookings: r?.total ?? 0,
      earnedRevenueCents: r?.earned ?? 0,
    };
  });
}

/** Appointments for one provider in a window (the "my day" view). */
export async function listProviderAppointments(
  clientId: string,
  providerId: string,
  from: Date,
  to: Date,
) {
  return db.query.appointments.findMany({
    where: and(
      eq(appointments.clientId, clientId),
      eq(appointments.providerId, providerId),
      isNull(appointments.deletedAt),
      sql`${appointments.status} not in ('cancelled', 'no_show')`,
      gte(appointments.startAt, from),
      lt(appointments.startAt, to),
    ),
    orderBy: (a, { asc }) => [asc(a.startAt)],
    with: { service: true },
  });
}
