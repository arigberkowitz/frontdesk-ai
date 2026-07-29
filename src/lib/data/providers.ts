import "server-only";
import { and, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { appointments, providers, services, type Provider } from "@/db/schema";

export async function listProviders(clientId: string): Promise<Provider[]> {
  return db.query.providers.findMany({
    where: and(eq(providers.clientId, clientId), isNull(providers.deletedAt)),
    orderBy: (p, { asc }) => [asc(p.name)],
  });
}

/** A provider is free at [startAt, endAt) when they have no overlapping active appointment. */
export async function findFreeProvider(
  clientId: string,
  startAt: Date,
  endAt: Date,
  preferredName?: string | null,
): Promise<Provider | null> {
  const team = (await listProviders(clientId)).filter((p) => p.isActive);
  if (team.length === 0) return null;

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
      gte(appointments.startAt, from),
      lt(appointments.startAt, to),
    ),
    orderBy: (a, { asc }) => [asc(a.startAt)],
    with: { service: true },
  });
}
