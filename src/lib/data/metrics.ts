import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { appointments, calls, clients, leads, services, subscriptions } from "@/db/schema";
import { COST_ASSUMPTIONS } from "@/config/plans";

/**
 * Analytics aggregates (§EPIC F). All counts come from SQL so they scale, and
 * every query is scoped by org/client (§12).
 */

export interface DayPoint {
  date: string; // YYYY-MM-DD
  calls: number;
  bookings: number;
}

export interface ClientMetrics {
  totalCalls: number;
  afterHoursCalls: number;
  bookings: number;
  leads: number;
  newLeads: number;
  escalated: number;
  missed: number;
  answerRate: number; // 0..1
  containmentRate: number; // 0..1 — handled without escalation
  sentimentScore: number | null; // -1..1
  avgServicePriceCents: number | null;
  estRevenueCents: number;
  callsByDay: DayPoint[];
  outcomes: { outcome: string; count: number }[];
}

function fillDays(
  rows: { date: string; calls: number; bookings: number }[],
  days: number,
  timeZone: string,
): DayPoint[] {
  const byDate = new Map(rows.map((r) => [r.date, r]));
  // en-CA formats as YYYY-MM-DD; format in the client's tz so the fill keys match
  // the tz-bucketed SQL below (a call near midnight lands on the right local day).
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const out: DayPoint[] = [];
  const now = Date.now();
  for (let i = days - 1; i >= 0; i--) {
    const key = fmt.format(new Date(now - i * 86_400_000));
    const row = byDate.get(key);
    out.push({ date: key, calls: row?.calls ?? 0, bookings: row?.bookings ?? 0 });
  }
  return out;
}

export async function getClientMetrics(clientId: string): Promise<ClientMetrics> {
  const scope = and(eq(calls.clientId, clientId), isNull(calls.deletedAt));

  // Bucket the daily chart in the client's own timezone, not the DB session's (UTC).
  const [clientRow] = await db
    .select({ tz: clients.timezone })
    .from(clients)
    .where(eq(clients.id, clientId));
  const timeZone = clientRow?.tz ?? "America/Los_Angeles";

  const [agg] = await db
    .select({
      total: sql<number>`count(*)::int`,
      afterHours: sql<number>`count(*) filter (where ${calls.isAfterHours})::int`,
      missed: sql<number>`count(*) filter (where ${calls.outcome} = 'missed')::int`,
      escalated: sql<number>`count(*) filter (where ${calls.outcome} = 'escalated')::int`,
      positive: sql<number>`count(*) filter (where ${calls.sentiment} = 'positive')::int`,
      negative: sql<number>`count(*) filter (where ${calls.sentiment} = 'negative')::int`,
      rated: sql<number>`count(*) filter (where ${calls.sentiment} in ('positive','neutral','negative'))::int`,
    })
    .from(calls)
    .where(scope);

  const [{ bookings }] = await db
    .select({ bookings: sql<number>`count(*)::int` })
    .from(appointments)
    .where(
      and(
        eq(appointments.clientId, clientId),
        isNull(appointments.deletedAt),
        // Realized bookings only — cancelled / no-shows aren't revenue.
        sql`${appointments.status} not in ('cancelled','no_show')`,
      ),
    );

  const [{ leadCount, newLeadCount }] = await db
    .select({
      leadCount: sql<number>`count(*)::int`,
      newLeadCount: sql<number>`count(*) filter (where ${leads.status} = 'new')::int`,
    })
    .from(leads)
    .where(and(eq(leads.clientId, clientId), isNull(leads.deletedAt)));

  const [{ avgPrice }] = await db
    .select({ avgPrice: sql<number | null>`avg(${services.priceCents})` })
    .from(services)
    .where(and(eq(services.clientId, clientId), eq(services.isActive, true), isNull(services.deletedAt)));

  const byDayRows = await db
    .select({
      date: sql<string>`to_char(date_trunc('day', ${calls.startAt} AT TIME ZONE ${timeZone}), 'YYYY-MM-DD')`,
      calls: sql<number>`count(*)::int`,
      bookings: sql<number>`count(*) filter (where ${calls.outcome} = 'booked')::int`,
    })
    .from(calls)
    .where(and(scope, sql`${calls.startAt} >= now() - interval '13 days'`))
    // Group by the SELECT's first column (the tz-bucketed date). Re-stating the
    // AT TIME ZONE expression here would bind the timezone as a *second* parameter,
    // which Postgres treats as a different expression → "must appear in GROUP BY".
    .groupBy(sql`1`);

  const outcomes = await db
    .select({ outcome: sql<string>`coalesce(${calls.outcome}::text, 'unknown')`, count: sql<number>`count(*)::int` })
    .from(calls)
    .where(scope)
    .groupBy(calls.outcome);

  const total = agg?.total ?? 0;
  const avgServicePriceCents = avgPrice != null ? Math.round(Number(avgPrice)) : null;
  const sentimentScore =
    agg && agg.rated > 0 ? (agg.positive - agg.negative) / agg.rated : null;

  return {
    totalCalls: total,
    afterHoursCalls: agg?.afterHours ?? 0,
    bookings,
    leads: leadCount,
    newLeads: newLeadCount,
    escalated: agg?.escalated ?? 0,
    missed: agg?.missed ?? 0,
    answerRate: total > 0 ? (total - (agg?.missed ?? 0)) / total : 1,
    containmentRate: total > 0 ? (total - (agg?.escalated ?? 0)) / total : 1,
    sentimentScore,
    avgServicePriceCents,
    estRevenueCents: bookings * (avgServicePriceCents ?? 0),
    callsByDay: fillDays(byDayRows, 14, timeZone),
    outcomes,
  };
}

export interface PeriodSummary {
  calls: number;
  bookings: number;
  afterHours: number;
  leads: number;
  estRevenueCents: number;
}

/** Windowed summary over the last `sinceDays` days — used by digests (§E3). */
export async function getClientPeriodSummary(
  clientId: string,
  sinceDays: number,
): Promise<PeriodSummary> {
  const since = sql`now() - make_interval(days => ${sinceDays})`;

  const [c] = await db
    .select({
      calls: sql<number>`count(*)::int`,
      afterHours: sql<number>`count(*) filter (where ${calls.isAfterHours})::int`,
    })
    .from(calls)
    .where(and(eq(calls.clientId, clientId), isNull(calls.deletedAt), sql`${calls.startAt} >= ${since}`));

  const [b] = await db
    .select({ bookings: sql<number>`count(*)::int` })
    .from(appointments)
    .where(
      and(
        eq(appointments.clientId, clientId),
        isNull(appointments.deletedAt),
        sql`${appointments.createdAt} >= ${since}`,
        sql`${appointments.status} not in ('cancelled','no_show')`,
      ),
    );

  const [l] = await db
    .select({ leads: sql<number>`count(*)::int` })
    .from(leads)
    .where(and(eq(leads.clientId, clientId), isNull(leads.deletedAt), sql`${leads.createdAt} >= ${since}`));

  const [p] = await db
    .select({ avgPrice: sql<number | null>`avg(${services.priceCents})` })
    .from(services)
    .where(and(eq(services.clientId, clientId), eq(services.isActive, true), isNull(services.deletedAt)));

  const avgPrice = p?.avgPrice != null ? Math.round(Number(p.avgPrice)) : 0;
  const bookings = b?.bookings ?? 0;
  return {
    calls: c?.calls ?? 0,
    bookings,
    afterHours: c?.afterHours ?? 0,
    leads: l?.leads ?? 0,
    estRevenueCents: bookings * avgPrice,
  };
}

export interface ClientRoi {
  windowDays: number;
  /** Estimated booked value over the window (bookings × avg service price), cents. */
  valueCents: number;
  /** The client's active/trial plan price, cents — null if not on a paid plan. */
  planCents: number | null;
  calls: number;
  bookings: number;
  afterHours: number;
  messages: number;
  /** value ÷ plan, only when both are positive — for the "Nx what you pay" line. */
  multiple: number | null;
}

/** "What your AI did vs. what you pay" — the portal ROI panel inputs (last 30 days). */
export async function getClientRoi(clientId: string): Promise<ClientRoi> {
  const summary = await getClientPeriodSummary(clientId, 30);
  const [sub] = await db
    .select({ cents: subscriptions.monthlyPriceCents })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.clientId, clientId),
        isNull(subscriptions.deletedAt),
        sql`${subscriptions.status} in ('active','trialing')`,
      ),
    )
    .limit(1);
  const planCents = sub?.cents ?? null;
  const valueCents = summary.estRevenueCents;
  const multiple = planCents && planCents > 0 && valueCents > 0 ? valueCents / planCents : null;
  return {
    windowDays: 30,
    valueCents,
    planCents,
    calls: summary.calls,
    bookings: summary.bookings,
    afterHours: summary.afterHours,
    messages: summary.leads,
    multiple,
  };
}

export interface WeeklyRecap {
  calls: number;
  bookings: number;
  valueCents: number;
  afterHours: number;
  callsDelta: number;
  bookingsDelta: number;
  valueDeltaCents: number;
  afterHoursDelta: number;
}

/** This week (last 7 days) vs. the 7 days before it — for the portal "this week" recap. */
export async function getClientWeeklyRecap(clientId: string): Promise<WeeklyRecap> {
  const [week, twoWeeks] = await Promise.all([
    getClientPeriodSummary(clientId, 7),
    getClientPeriodSummary(clientId, 14),
  ]);
  const priorCalls = twoWeeks.calls - week.calls;
  const priorBookings = twoWeeks.bookings - week.bookings;
  const priorAfterHours = twoWeeks.afterHours - week.afterHours;
  const priorValue = twoWeeks.estRevenueCents - week.estRevenueCents;
  return {
    calls: week.calls,
    bookings: week.bookings,
    valueCents: week.estRevenueCents,
    afterHours: week.afterHours,
    callsDelta: week.calls - priorCalls,
    bookingsDelta: week.bookings - priorBookings,
    valueDeltaCents: week.estRevenueCents - priorValue,
    afterHoursDelta: week.afterHours - priorAfterHours,
  };
}

export interface PortfolioClientCard {
  id: string;
  name: string;
  status: string;
  callsToday: number;
  totalCalls: number;
  bookings: number;
  newLeads: number;
}

export interface PortfolioMetrics {
  totalClients: number;
  activeClients: number;
  callsToday: number;
  bookingsToday: number;
  afterHoursThisWeek: number;
  newLeads: number;
  mrrCents: number;
  estRevenueMonthCents: number;
  marginCents: number;
  clients: PortfolioClientCard[];
  // Component figures behind the headline numbers — surfaced in the card breakdowns.
  bookingsThisMonth: number;
  avgServiceCents: number;
  retellCostMonthCents: number;
  overheadCents: number;
  mrrByClient: { name: string; cents: number }[];
  // Chart series across all clients.
  callsByDay: DayPoint[];
  outcomes: { outcome: string; count: number }[];
}

export async function getPortfolioMetrics(orgId: string): Promise<PortfolioMetrics> {
  const rows = await db
    .select({ id: clients.id, name: clients.name, status: clients.status })
    .from(clients)
    .where(and(eq(clients.orgId, orgId), isNull(clients.deletedAt)));

  const ids = rows.map((r) => r.id);
  const empty: PortfolioMetrics = {
    totalClients: 0,
    activeClients: 0,
    callsToday: 0,
    bookingsToday: 0,
    afterHoursThisWeek: 0,
    newLeads: 0,
    mrrCents: 0,
    estRevenueMonthCents: 0,
    marginCents: 0,
    clients: [],
    bookingsThisMonth: 0,
    avgServiceCents: 0,
    retellCostMonthCents: 0,
    overheadCents: 0,
    mrrByClient: [],
    callsByDay: fillDays([], 14, "UTC"),
    outcomes: [],
  };
  if (!ids.length) return empty;

  const activeClients = rows.filter((r) => r.status === "live" || r.status === "trial").length;

  const [callAgg] = await db
    .select({
      today: sql<number>`count(*) filter (where ${calls.startAt} >= date_trunc('day', now()))::int`,
      afterHoursWeek: sql<number>`count(*) filter (where ${calls.isAfterHours} and ${calls.startAt} >= now() - interval '7 days')::int`,
      retellCostMonth: sql<number>`coalesce(sum(${calls.retellCostCents}) filter (where ${calls.startAt} >= date_trunc('month', now())), 0)::int`,
    })
    .from(calls)
    .where(and(inArray(calls.clientId, ids), isNull(calls.deletedAt)));

  const [apptAgg] = await db
    .select({
      today: sql<number>`count(*) filter (where ${appointments.createdAt} >= date_trunc('day', now()))::int`,
      month: sql<number>`count(*) filter (where ${appointments.createdAt} >= date_trunc('month', now()) and ${appointments.status} not in ('cancelled','no_show'))::int`,
    })
    .from(appointments)
    .where(and(inArray(appointments.clientId, ids), isNull(appointments.deletedAt)));

  const [{ avgPrice }] = await db
    .select({ avgPrice: sql<number | null>`avg(${services.priceCents})` })
    .from(services)
    .where(and(inArray(services.clientId, ids), eq(services.isActive, true), isNull(services.deletedAt)));

  const [{ mrr }] = await db
    .select({ mrr: sql<number>`coalesce(sum(${subscriptions.monthlyPriceCents}) filter (where ${subscriptions.status} in ('active','trialing')), 0)::int` })
    .from(subscriptions)
    .where(and(inArray(subscriptions.clientId, ids), isNull(subscriptions.deletedAt)));

  const callsByClient = await db
    .select({
      clientId: calls.clientId,
      total: sql<number>`count(*)::int`,
      today: sql<number>`count(*) filter (where ${calls.startAt} >= date_trunc('day', now()))::int`,
    })
    .from(calls)
    .where(and(inArray(calls.clientId, ids), isNull(calls.deletedAt)))
    .groupBy(calls.clientId);

  const apptByClient = await db
    .select({ clientId: appointments.clientId, total: sql<number>`count(*)::int` })
    .from(appointments)
    .where(and(inArray(appointments.clientId, ids), isNull(appointments.deletedAt)))
    .groupBy(appointments.clientId);

  const mrrRows = await db
    .select({ name: clients.name, cents: subscriptions.monthlyPriceCents })
    .from(subscriptions)
    .innerJoin(clients, eq(subscriptions.clientId, clients.id))
    .where(
      and(
        inArray(subscriptions.clientId, ids),
        isNull(subscriptions.deletedAt),
        sql`${subscriptions.status} in ('active','trialing')`,
      ),
    );

  const byDayRows = await db
    .select({
      date: sql<string>`to_char(date_trunc('day', ${calls.startAt} AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`,
      calls: sql<number>`count(*)::int`,
      bookings: sql<number>`count(*) filter (where ${calls.outcome} = 'booked')::int`,
    })
    .from(calls)
    .where(
      and(
        inArray(calls.clientId, ids),
        isNull(calls.deletedAt),
        sql`${calls.startAt} >= now() - interval '13 days'`,
      ),
    )
    .groupBy(sql`1`);

  const outcomeRows = await db
    .select({
      outcome: sql<string>`coalesce(${calls.outcome}::text, 'unknown')`,
      count: sql<number>`count(*)::int`,
    })
    .from(calls)
    .where(and(inArray(calls.clientId, ids), isNull(calls.deletedAt)))
    .groupBy(calls.outcome);

  const newLeadsByClient = await db
    .select({
      clientId: leads.clientId,
      count: sql<number>`count(*) filter (where ${leads.status} = 'new')::int`,
    })
    .from(leads)
    .where(and(inArray(leads.clientId, ids), isNull(leads.deletedAt)))
    .groupBy(leads.clientId);

  const callMap = new Map(callsByClient.map((c) => [c.clientId, c]));
  const apptMap = new Map(apptByClient.map((a) => [a.clientId, a.total]));
  const newLeadMap = new Map(newLeadsByClient.map((l) => [l.clientId, l.count]));
  const newLeads = newLeadsByClient.reduce((sum, l) => sum + l.count, 0);

  const avgServiceCents = avgPrice != null ? Math.round(Number(avgPrice)) : 0;
  const bookingsThisMonth = apptAgg?.month ?? 0;
  const estRevenueMonthCents = bookingsThisMonth * avgServiceCents;
  const overheadCents = activeClients * COST_ASSUMPTIONS.overheadPerClientCents;
  const retellCostMonthCents = callAgg?.retellCostMonth ?? 0;
  const marginCents = (mrr ?? 0) - retellCostMonthCents - overheadCents;

  return {
    totalClients: rows.length,
    activeClients,
    callsToday: callAgg?.today ?? 0,
    bookingsToday: apptAgg?.today ?? 0,
    afterHoursThisWeek: callAgg?.afterHoursWeek ?? 0,
    newLeads,
    mrrCents: mrr ?? 0,
    estRevenueMonthCents,
    marginCents,
    clients: rows.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      callsToday: callMap.get(r.id)?.today ?? 0,
      totalCalls: callMap.get(r.id)?.total ?? 0,
      bookings: apptMap.get(r.id) ?? 0,
      newLeads: newLeadMap.get(r.id) ?? 0,
    })),
    bookingsThisMonth,
    avgServiceCents,
    retellCostMonthCents,
    overheadCents,
    mrrByClient: mrrRows.map((r) => ({ name: r.name, cents: r.cents ?? 0 })),
    callsByDay: fillDays(byDayRows, 14, "UTC"),
    outcomes: outcomeRows,
  };
}
