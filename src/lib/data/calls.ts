import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { calls, clients, type NewCall } from "@/db/schema";
import { analyzeCall, summarize } from "@/lib/call-health";

/** Call data access + the idempotent webhook upsert. */

export async function listCalls(clientId: string, limit = 100) {
  return db.query.calls.findMany({
    where: and(eq(calls.clientId, clientId), isNull(calls.deletedAt)),
    orderBy: [desc(calls.startAt), desc(calls.createdAt)],
    limit,
  });
}

/** Operator-scoped single call (verifies the call's client belongs to the org). */
export async function getCall(orgId: string, callId: string) {
  const call = await db.query.calls.findFirst({
    where: and(eq(calls.id, callId), isNull(calls.deletedAt)),
    with: { client: true, appointments: true, leads: true },
  });
  if (!call || call.client.orgId !== orgId) return null;
  return call;
}

/** Client-scoped single call (portal — a viewer only sees their own client's calls). */
export async function getCallForClient(clientId: string, callId: string) {
  const call = await db.query.calls.findFirst({
    where: and(eq(calls.id, callId), eq(calls.clientId, clientId), isNull(calls.deletedAt)),
    with: { client: true, appointments: true, leads: true },
  });
  return call ?? null;
}

/** Find a call by Retell id within a client (used by agent-tool callbacks). */
export async function getCallByRetellId(clientId: string, retellCallId: string) {
  return db.query.calls.findFirst({
    where: and(eq(calls.clientId, clientId), eq(calls.retellCallId, retellCallId)),
  });
}

/**
 * Idempotent upsert keyed on `retell_call_id` (§C5): replaying the same webhook
 * updates the row in place rather than inserting a duplicate.
 */
export async function upsertCallByRetellId(
  values: NewCall & { retellCallId: string },
) {
  const [row] = await db
    .insert(calls)
    .values(values)
    .onConflictDoUpdate({ target: calls.retellCallId, set: values })
    .returning();
  return row;
}

export async function countCallsToday(orgId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(calls)
    .innerJoin(clients, eq(calls.clientId, clients.id))
    .where(
      and(
        eq(clients.orgId, orgId),
        isNull(calls.deletedAt),
        sql`${calls.startAt} >= date_trunc('day', now())`,
      ),
    );
  return row?.n ?? 0;
}

/* ----------------------------- call health ------------------------------- */

/**
 * The last N days of calls, scored for what went wrong.
 *
 * Every competitor's dashboard answers "how many calls did we answer?". This
 * answers "which of them failed, and how?" — hang-ups in the first seconds,
 * callers who asked for a person and didn't get one, questions the agent had
 * to ask three times, calls that ended with nobody's number.
 *
 * The scoring is rule-based on the transcript (see lib/call-health), not a
 * model's opinion, so every count links to a recording the owner can check.
 */
export async function getCallHealth(clientId: string, days = 30) {
  const rows = await db.query.calls.findMany({
    where: and(
      eq(calls.clientId, clientId),
      isNull(calls.deletedAt),
      sql`${calls.startAt} >= now() - make_interval(days => ${days})`,
    ),
    orderBy: [desc(calls.startAt)],
    limit: 500,
    with: { leads: { columns: { id: true } }, appointments: { columns: { id: true } } },
  });

  const scored = rows.map((call) => ({
    call,
    health: analyzeCall({
      transcript: call.transcript,
      durationSec: call.durationSec,
      outcome: call.outcome,
      // A lead or a booking means we came away with someone we can reach.
      hasContact: call.leads.length > 0 || call.appointments.length > 0,
      transferConnected: call.outcome === "escalated",
    }),
  }));

  return {
    summary: summarize(scored.map((s) => s.health)),
    // Worst first: the ones an owner should actually listen to.
    needsAttention: scored
      .filter((s) => !s.health.clean)
      .slice(0, 20)
      .map((s) => ({
        id: s.call.id,
        startAt: s.call.startAt,
        fromNumber: s.call.fromNumber,
        durationSec: s.call.durationSec,
        problems: s.health.problems,
        notes: s.health.notes,
      })),
  };
}
