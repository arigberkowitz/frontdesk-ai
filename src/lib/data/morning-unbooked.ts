import "server-only";
import { and, desc, eq, gte, inArray, isNull, lt, ne, notInArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { appointments, calls, leads, notifications } from "@/db/schema";
import {
  MORNING_UNBOOKED_KIND,
  phoneKey,
  pickUnbookedCallers,
  type AfterHoursCallRow,
  type MorningWindow,
  type UnbookedCaller,
} from "@/lib/morning-unbooked";
import { logger } from "@/lib/logger";

/**
 * Data for the morning "didn't book" owner text. Every query is scoped by
 * client_id. Dedupe lives in `notifications` (type digest_daily, payload.kind
 * `morning_unbooked_text`, payload.dayKey) — the same pattern as the daily
 * briefing — so this feature needs no migration.
 */

const MAX_CALLS = 60;

/**
 * Last night's after-hours callers who didn't book. Returns null (= skip,
 * send nothing) if any query fails, e.g. a lagging migration on a column we
 * read — the feature must never text an owner a half-built list.
 */
export async function getUnbookedAfterHoursCallers(
  client: { id: string; setupFlags?: { blockedNumbers?: string[] } | null },
  w: MorningWindow,
): Promise<UnbookedCaller[] | null> {
  try {
    const rows = await db
      .select({
        callId: calls.id,
        fromNumber: calls.fromNumber,
        startAt: calls.startAt,
        outcome: calls.outcome,
        summary: calls.summary,
        leadId: leads.id,
        leadName: leads.name,
        leadPhone: leads.phone,
        leadReason: leads.reason,
        leadService: leads.service,
        leadStatus: leads.status,
        leadLastReplyAt: leads.lastReplyAt,
      })
      .from(calls)
      .leftJoin(leads, and(eq(leads.callId, calls.id), eq(leads.clientId, client.id), isNull(leads.deletedAt)))
      .where(
        and(
          eq(calls.clientId, client.id),
          isNull(calls.deletedAt),
          eq(calls.direction, "inbound"),
          eq(calls.isAfterHours, true),
          gte(calls.startAt, w.start),
          lt(calls.startAt, w.end),
          or(isNull(calls.outcome), notInArray(calls.outcome, ["booked", "spam"])),
        ),
      )
      .orderBy(desc(calls.startAt))
      .limit(MAX_CALLS);
    if (!rows.length) return [];

    const callIds = rows.map((r) => r.callId);
    // Anything booked since the window opened — on the call itself, or later
    // by phone, web chat or text — means this caller doesn't need chasing.
    const booked = await db
      .select({ callId: appointments.callId, phone: appointments.customerPhone })
      .from(appointments)
      .where(
        and(
          eq(appointments.clientId, client.id),
          isNull(appointments.deletedAt),
          ne(appointments.status, "cancelled"),
          or(gte(appointments.createdAt, w.start), inArray(appointments.callId, callIds)),
        ),
      );
    const bookedPhones = new Set(booked.map((b) => phoneKey(b.phone)).filter((k): k is string => Boolean(k)));
    const bookedCallIds = new Set(booked.map((b) => b.callId).filter((id): id is string => Boolean(id)));

    const callRows: AfterHoursCallRow[] = rows.map((r) => ({
      callId: r.callId,
      fromNumber: r.fromNumber,
      startAt: r.startAt,
      outcome: r.outcome,
      summary: r.summary,
      lead: r.leadId
        ? {
            id: r.leadId,
            name: r.leadName,
            phone: r.leadPhone,
            reason: r.leadReason,
            service: r.leadService,
            status: r.leadStatus ?? "new",
          }
        : null,
    }));
    const repliedLeadIds = new Set(
      rows.filter((r) => r.leadId && r.leadLastReplyAt).map((r) => r.leadId as string),
    );
    return pickUnbookedCallers(callRows, {
      bookedPhones,
      bookedCallIds,
      blockedNumbers: client.setupFlags?.blockedNumbers ?? null,
      repliedLeadIds,
    });
  } catch (err) {
    logger.warn("morning_unbooked.query_failed", {
      clientId: client.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Claim this business's text for `dayKey`. Null = already sent (or being sent) today. */
export async function claimMorningUnbooked(
  clientId: string,
  dayKey: string,
  recipient: string,
): Promise<string | null> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`morning-unbooked:${clientId}:${dayKey}`}))`);
    const existing = await tx
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.clientId, clientId),
          sql`${notifications.payload}->>'kind' = ${MORNING_UNBOOKED_KIND}`,
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
        channel: "sms",
        recipient,
        payload: { kind: MORNING_UNBOOKED_KIND, dayKey, claimedAt: new Date().toISOString() },
        status: "queued",
      })
      .returning({ id: notifications.id });
    return row?.id ?? null;
  });
}

export async function finishMorningUnbooked(
  id: string,
  outcome: {
    status: "sent" | "failed" | "skipped";
    dayKey: string;
    body: string;
    recipients: string[];
    callers: number;
    error?: string | null;
  },
): Promise<void> {
  await db
    .update(notifications)
    .set({
      status: outcome.status === "sent" ? "sent" : outcome.status === "failed" ? "failed" : "queued",
      sentAt: outcome.status === "sent" ? new Date() : null,
      payload: {
        kind: MORNING_UNBOOKED_KIND,
        dayKey: outcome.dayKey,
        body: outcome.body,
        recipients: outcome.recipients,
        callers: outcome.callers,
        skipped: outcome.status === "skipped",
        error: outcome.error ?? null,
      },
    })
    .where(eq(notifications.id, id));
}

/** When the morning text last actually went out — for the Overview status line. */
export async function lastMorningUnbookedSentAt(clientId: string): Promise<Date | null> {
  const [r] = await db
    .select({ sentAt: notifications.sentAt })
    .from(notifications)
    .where(
      and(
        eq(notifications.clientId, clientId),
        eq(notifications.type, "digest_daily"),
        eq(notifications.status, "sent"),
        sql`${notifications.payload}->>'kind' = ${MORNING_UNBOOKED_KIND}`,
      ),
    )
    .orderBy(desc(notifications.sentAt))
    .limit(1);
  return r?.sentAt ?? null;
}
