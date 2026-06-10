import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { calls, clients, type NewCall } from "@/db/schema";

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
