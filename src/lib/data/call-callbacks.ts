import "server-only";
import { and, desc, eq, gt, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { appointments, callCallbacks, calls, type CallCallbackRow } from "@/db/schema";
import { DEDUPE_DAYS, MAX_CALL_AGE_HOURS, type CallbackReason } from "@/lib/missed-call";

/**
 * The missed-call callback ledger. One row per call considered — the unique
 * call_id makes a replayed Retell webhook a no-op — and the per-phone dedupe
 * runs under an advisory lock so two calls from the same number finishing at
 * once can't both text them.
 */

export type ClaimResult =
  | { kind: "claimed"; row: CallCallbackRow }
  | { kind: "duplicate_call" }
  | { kind: "recent_callback" };

export async function claimCallback(input: {
  clientId: string;
  callId: string;
  phoneKey: string;
  reason: CallbackReason;
  sendAfter: Date;
}): Promise<ClaimResult> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`call-callback:${input.clientId}:${input.phoneKey}`}))`,
    );
    const existing = await tx
      .select({ id: callCallbacks.id })
      .from(callCallbacks)
      .where(eq(callCallbacks.callId, input.callId))
      .limit(1);
    if (existing.length > 0) return { kind: "duplicate_call" as const };

    const recent = await tx
      .select({ id: callCallbacks.id })
      .from(callCallbacks)
      .where(
        and(
          eq(callCallbacks.clientId, input.clientId),
          eq(callCallbacks.customerPhone, input.phoneKey),
          inArray(callCallbacks.status, ["pending", "sent"]),
          sql`${callCallbacks.createdAt} > now() - make_interval(days => ${DEDUPE_DAYS})`,
        ),
      )
      .limit(1);
    const dup = recent.length > 0;
    const [row] = await tx
      .insert(callCallbacks)
      .values({
        clientId: input.clientId,
        callId: input.callId,
        customerPhone: input.phoneKey,
        reason: input.reason,
        status: dup ? "skipped" : "pending",
        skipReason: dup ? "recent_callback" : null,
        sendAfter: input.sendAfter,
      })
      .onConflictDoNothing({ target: callCallbacks.callId })
      .returning();
    if (!row) return { kind: "duplicate_call" as const };
    return dup ? { kind: "recent_callback" as const } : { kind: "claimed" as const, row };
  });
}

/** Record a call we looked at and decided not to follow up (for the portal's counts). */
export async function recordSkippedCallback(input: {
  clientId: string;
  callId: string;
  phoneKey: string;
  reason: string;
  skipReason: string;
}): Promise<void> {
  await db
    .insert(callCallbacks)
    .values({
      clientId: input.clientId,
      callId: input.callId,
      customerPhone: input.phoneKey,
      reason: input.reason,
      status: "skipped",
      skipReason: input.skipReason,
    })
    .onConflictDoNothing({ target: callCallbacks.callId });
}

export async function updateCallback(
  id: string,
  patch: Partial<
    Pick<CallCallbackRow, "status" | "skipReason" | "channel" | "sentAt" | "retellCallId" | "error" | "sendAfter">
  >,
): Promise<void> {
  await db
    .update(callCallbacks)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(callCallbacks.id, id), eq(callCallbacks.status, "pending")));
}

/** Sent in the last 24h for this business — the daily cap. */
export async function sentLastDay(clientId: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(callCallbacks)
    .where(
      and(
        eq(callCallbacks.clientId, clientId),
        eq(callCallbacks.status, "sent"),
        sql`${callCallbacks.sentAt} > now() - interval '24 hours'`,
      ),
    );
  return r?.n ?? 0;
}

/** Pending rows whose send time has come, still fresh enough to be useful. */
export async function duePendingCallbacks(now: Date, limit = 200): Promise<CallCallbackRow[]> {
  return db
    .select()
    .from(callCallbacks)
    .where(
      and(
        eq(callCallbacks.status, "pending"),
        lte(callCallbacks.sendAfter, now),
        gt(callCallbacks.createdAt, new Date(now.getTime() - MAX_CALL_AGE_HOURS * 3_600_000)),
      ),
    )
    .orderBy(callCallbacks.createdAt)
    .limit(limit);
}

/** Expire pending rows that went stale (e.g. never reached texting hours in time). */
export async function expireStaleCallbacks(now: Date): Promise<void> {
  await db
    .update(callCallbacks)
    .set({ status: "skipped", skipReason: "too_old", updatedAt: now })
    .where(
      and(
        eq(callCallbacks.status, "pending"),
        lte(callCallbacks.createdAt, new Date(now.getTime() - MAX_CALL_AGE_HOURS * 3_600_000)),
      ),
    );
}

const digitsSql = (col: typeof calls.fromNumber | typeof appointments.customerPhone) =>
  sql`right(regexp_replace(coalesce(${col}, ''), '[^0-9]', '', 'g'), 10)`;

/** Did this number call the business again after `since`? Then they're already engaged. */
export async function calledAgainSince(
  clientId: string,
  phoneKey: string,
  since: Date,
  excludeCallId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: calls.id })
    .from(calls)
    .where(
      and(
        eq(calls.clientId, clientId),
        ne(calls.id, excludeCallId),
        eq(calls.direction, "inbound"),
        gt(calls.startAt, since),
        sql`${digitsSql(calls.fromNumber)} = ${phoneKey.slice(-10)}`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Is this number already on the books — an upcoming appointment, or one made
 * since the call (e.g. they booked online or rang back)?
 */
export async function hasBookingFor(clientId: string, phoneKey: string, since: Date): Promise<boolean> {
  const rows = await db
    .select({ id: appointments.id })
    .from(appointments)
    .where(
      and(
        eq(appointments.clientId, clientId),
        isNull(appointments.deletedAt),
        sql`${appointments.status} not in ('cancelled', 'no_show')`,
        sql`(${appointments.startAt} > now() or ${appointments.createdAt} >= ${since})`,
        sql`${digitsSql(appointments.customerPhone)} = ${phoneKey.slice(-10)}`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export interface CallbackStats {
  sent: number;
  skipped: number;
  pending: number;
  failed: number;
  recent: Pick<CallCallbackRow, "id" | "customerPhone" | "reason" | "status" | "skipReason" | "channel" | "createdAt">[];
}

/** Last-N-days counts for the Settings card. */
export async function callbackStats(clientId: string, days = 7): Promise<CallbackStats> {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db
    .select({
      id: callCallbacks.id,
      customerPhone: callCallbacks.customerPhone,
      reason: callCallbacks.reason,
      status: callCallbacks.status,
      skipReason: callCallbacks.skipReason,
      channel: callCallbacks.channel,
      createdAt: callCallbacks.createdAt,
    })
    .from(callCallbacks)
    .where(and(eq(callCallbacks.clientId, clientId), gte(callCallbacks.createdAt, since)))
    .orderBy(desc(callCallbacks.createdAt))
    .limit(500);
  const count = (s: string) => rows.filter((r) => r.status === s).length;
  return {
    sent: count("sent"),
    skipped: count("skipped"),
    pending: count("pending"),
    failed: count("failed"),
    recent: rows.filter((r) => r.status !== "skipped").slice(0, 5),
  };
}
