import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { appointments, calls, leads, notifications, services } from "@/db/schema";
import { analyzeCall } from "@/lib/call-health";
import {
  briefingWindow,
  isUrgentText,
  type BriefingAppointment,
  type BriefingCallback,
  type BriefingCard,
  type BriefingFacts,
} from "@/lib/daily-briefing";

/**
 * Data for the daily owner briefing. Every query is scoped by `client_id`, and
 * every window is the business's own calendar day (not UTC).
 *
 * Dedupe and the stored card live in `notifications` (type `digest_daily`,
 * payload.kind `daily_briefing`, payload.dayKey) — the same pattern as reply
 * alerts — so this feature needs no migration.
 */

export const DAILY_BRIEFING_KIND = "daily_briefing";
/** How far back an unanswered message still counts as "needs a callback". */
export const OPEN_MESSAGE_DAYS = 7;
const MAX_CALLBACKS = 12;

export async function getBriefingFacts(
  client: { id: string; name: string; timezone: string },
  now: Date = new Date(),
): Promise<BriefingFacts> {
  const tz = client.timezone;
  const w = briefingWindow(now, tz);
  const inYesterday = (col: typeof calls.startAt | typeof appointments.createdAt) =>
    and(gte(col, w.yesterdayStart), lt(col, w.todayStart));

  const [c] = await db
    .select({
      calls: sql<number>`count(*) filter (where ${calls.direction} = 'inbound')::int`,
      booked: sql<number>`count(*) filter (where ${calls.direction} = 'inbound' and ${calls.outcome} = 'booked')::int`,
      messages: sql<number>`count(*) filter (where ${calls.direction} = 'inbound' and ${calls.outcome} = 'lead')::int`,
      afterHours: sql<number>`count(*) filter (where ${calls.direction} = 'inbound' and ${calls.isAfterHours})::int`,
      spam: sql<number>`count(*) filter (where ${calls.direction} = 'inbound' and ${calls.outcome} = 'spam')::int`,
    })
    .from(calls)
    .where(and(eq(calls.clientId, client.id), isNull(calls.deletedAt), inYesterday(calls.startAt)));

  const [a] = await db
    .select({
      bookingsMade: sql<number>`count(*) filter (where ${appointments.createdAt} >= ${w.yesterdayStart} and ${appointments.createdAt} < ${w.todayStart} and ${appointments.status} not in ('cancelled','no_show'))::int`,
      // No cancelled_at column: the status flip's updated_at is when it
      // happened (same rule as the weekly summary).
      cancellations: sql<number>`count(*) filter (where ${appointments.status} = 'cancelled' and ${appointments.updatedAt} >= ${w.yesterdayStart} and ${appointments.updatedAt} < ${w.todayStart})::int`,
    })
    .from(appointments)
    .where(and(eq(appointments.clientId, client.id), isNull(appointments.deletedAt)));

  const apptCols = {
    id: appointments.id,
    startAt: appointments.startAt,
    customerName: appointments.customerName,
    status: appointments.status,
    service: services.name,
  };
  const [todayRows, cancelledRows] = await Promise.all([
    db
      .select(apptCols)
      .from(appointments)
      .leftJoin(services, eq(appointments.serviceId, services.id))
      .where(
        and(
          eq(appointments.clientId, client.id),
          isNull(appointments.deletedAt),
          inArray(appointments.status, ["booked", "confirmed"]),
          gte(appointments.startAt, w.todayStart),
          lt(appointments.startAt, w.tomorrowStart),
        ),
      )
      .orderBy(asc(appointments.startAt))
      .limit(30),
    db
      .select(apptCols)
      .from(appointments)
      .leftJoin(services, eq(appointments.serviceId, services.id))
      .where(
        and(
          eq(appointments.clientId, client.id),
          isNull(appointments.deletedAt),
          eq(appointments.status, "cancelled"),
          gte(appointments.updatedAt, w.yesterdayStart),
          lt(appointments.updatedAt, w.todayStart),
        ),
      )
      .orderBy(asc(appointments.startAt))
      .limit(10),
  ]);
  const toAppt = (r: (typeof todayRows)[number], i: number): BriefingAppointment => ({
    ref: `A${i + 1}`,
    startAt: r.startAt,
    customerName: r.customerName,
    service: r.service ?? null,
    status: r.status,
  });

  // Who needs a callback: open messages from the last week (nobody has marked
  // them contacted and the customer hasn't texted back), plus yesterday's
  // calls where a handoff to a person failed and no message was taken.
  const openLeads = await db
    .select({
      id: leads.id,
      callId: leads.callId,
      name: leads.name,
      phone: leads.phone,
      reason: leads.reason,
      message: leads.message,
      urgency: leads.urgency,
      createdAt: leads.createdAt,
    })
    .from(leads)
    .where(
      and(
        eq(leads.clientId, client.id),
        isNull(leads.deletedAt),
        eq(leads.status, "new"),
        isNull(leads.lastReplyAt),
        gte(leads.createdAt, new Date(w.todayStart.getTime() - OPEN_MESSAGE_DAYS * 86_400_000)),
      ),
    )
    .orderBy(desc(leads.createdAt))
    .limit(MAX_CALLBACKS);

  const yesterdayCalls = await db
    .select({
      id: calls.id,
      fromNumber: calls.fromNumber,
      startAt: calls.startAt,
      transcript: calls.transcript,
      durationSec: calls.durationSec,
      outcome: calls.outcome,
    })
    .from(calls)
    .where(
      and(
        eq(calls.clientId, client.id),
        isNull(calls.deletedAt),
        eq(calls.direction, "inbound"),
        sql`coalesce(${calls.outcome}::text, '') <> 'spam'`,
        inYesterday(calls.startAt),
      ),
    )
    .orderBy(desc(calls.startAt))
    .limit(200);

  const callsWithLead = new Set(openLeads.map((l) => l.callId).filter(Boolean));
  const callbacks: BriefingCallback[] = openLeads.map((l) => ({
    ref: "",
    kind: "message",
    at: l.createdAt,
    name: l.name,
    phone: l.phone,
    reason: [l.reason, l.message].filter(Boolean).join(" — ") || null,
    urgency: l.urgency,
    urgent: isUrgentText(l.reason, l.message, l.urgency),
    callId: l.callId,
    leadId: l.id,
  }));
  for (const call of yesterdayCalls) {
    if (callsWithLead.has(call.id) || call.outcome === "lead" || call.outcome === "booked") continue;
    const health = analyzeCall({
      transcript: call.transcript,
      durationSec: call.durationSec,
      outcome: call.outcome,
    });
    const failed = health.problems.includes("transferred_to_voicemail") || health.problems.includes("transfer_dropped");
    const stranded = health.problems.includes("stranded_asking_for_human");
    if (!failed && !stranded) continue;
    callbacks.push({
      ref: "",
      kind: failed ? "transfer_failed" : "asked_for_person",
      at: call.startAt ?? w.yesterdayStart,
      name: null,
      phone: call.fromNumber,
      reason: null,
      urgency: null,
      urgent: health.problems.includes("possible_emergency"),
      callId: call.id,
      leadId: null,
    });
  }
  const trimmed = callbacks.slice(0, MAX_CALLBACKS).map((cb, i) => ({ ...cb, ref: `C${i + 1}` }));

  return {
    businessName: client.name,
    timeZone: tz,
    dayKey: w.dayKey,
    counts: {
      calls: c?.calls ?? 0,
      booked: c?.booked ?? 0,
      messages: c?.messages ?? 0,
      afterHours: c?.afterHours ?? 0,
      spam: c?.spam ?? 0,
      bookingsMade: a?.bookingsMade ?? 0,
      cancellations: a?.cancellations ?? 0,
    },
    cancellations: cancelledRows.map(toAppt),
    callbacks: trimmed,
    today: todayRows.map(toAppt),
  };
}

/**
 * Claim today's briefing for a business. One `notifications` row per business
 * per local day is the dedupe: an advisory lock on (business, day) makes the
 * check-and-insert atomic, so overlapping cron slots or a manual curl can't
 * send twice. A failed send, or one skipped because email isn't configured,
 * doesn't hold the day, so a later slot retries it.
 *
 * Returns the claimed row id, or null when today is already taken.
 */
export async function claimDailyBriefing(
  clientId: string,
  dayKey: string,
  recipient: string,
): Promise<string | null> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`daily-briefing:${clientId}:${dayKey}`}))`);
    const existing = await tx
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.clientId, clientId),
          sql`${notifications.payload}->>'kind' = ${DAILY_BRIEFING_KIND}`,
          sql`${notifications.payload}->>'dayKey' = ${dayKey}`,
          ne(notifications.status, "failed"),
          sql`coalesce(${notifications.payload}->>'skipped', 'false') <> 'true'`,
        ),
      )
      .limit(1);
    if (existing.length > 0) return null;
    const [row] = await tx
      .insert(notifications)
      .values({
        clientId,
        type: "digest_daily",
        channel: "email",
        recipient,
        payload: { kind: DAILY_BRIEFING_KIND, dayKey, claimedAt: new Date().toISOString() },
        status: "queued",
      })
      .returning({ id: notifications.id });
    return row?.id ?? null;
  });
}

export async function finishDailyBriefing(
  id: string,
  outcome: {
    status: "sent" | "failed" | "skipped";
    dayKey: string;
    subject: string;
    card: BriefingCard;
    usedAi: boolean;
    error?: string | null;
  },
): Promise<void> {
  await db
    .update(notifications)
    .set({
      status: outcome.status === "sent" ? "sent" : outcome.status === "failed" ? "failed" : "queued",
      sentAt: outcome.status === "sent" ? new Date() : null,
      payload: {
        kind: DAILY_BRIEFING_KIND,
        dayKey: outcome.dayKey,
        subject: outcome.subject,
        card: outcome.card,
        usedAi: outcome.usedAi,
        skipped: outcome.status === "skipped",
        error: outcome.error ?? null,
      },
    })
    .where(eq(notifications.id, id));
}

/** Today's briefing card, if one was generated. One indexed read, no model call. */
export async function getStoredBriefingCard(
  clientId: string,
  dayKey: string,
): Promise<BriefingCard | null> {
  try {
    const [row] = await db
      .select({ payload: notifications.payload })
      .from(notifications)
      .where(
        and(
          eq(notifications.clientId, clientId),
          sql`${notifications.payload}->>'kind' = ${DAILY_BRIEFING_KIND}`,
          sql`${notifications.payload}->>'dayKey' = ${dayKey}`,
          sql`${notifications.payload}->'card' is not null`,
        ),
      )
      .orderBy(desc(notifications.createdAt))
      .limit(1);
    const card = (row?.payload as { card?: BriefingCard } | undefined)?.card;
    return card ?? null;
  } catch {
    return null;
  }
}
