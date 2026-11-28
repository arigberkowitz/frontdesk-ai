import "server-only";
import { and, desc, eq, gte, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { calls, clients } from "@/db/schema";
import {
  isBlocked,
  MAX_TURNED_AWAY,
  normalizeForBlock,
  screenInboundCaller,
  SCREEN_WINDOW_DAYS,
  type InboundScreen,
  type InboundScreenReason,
  type TurnedAwayEntry,
} from "@/lib/spam";

export interface InboundCallInfo {
  agentId?: string | null;
  toNumber?: string | null;
  fromNumber?: string | null;
}

/**
 * Should this incoming call reach the AI? Reads only the caller number Retell
 * sends with the inbound webhook and this business's own call log.
 * Returns the business it matched (null when none) and the decision.
 */
export async function screenInboundCall(
  info: InboundCallInfo,
  now = new Date(),
): Promise<{ clientId: string | null; screen: InboundScreen }> {
  const pass: InboundScreen = { reject: false, reason: null };
  const byAgent = info.agentId ? eq(clients.retellAgentId, info.agentId) : null;
  const byNumber = info.toNumber ? eq(clients.retellPhoneNumber, info.toNumber) : null;
  const match = byAgent && byNumber ? or(byAgent, byNumber) : (byAgent ?? byNumber);
  if (!match) return { clientId: null, screen: pass };

  const [client] = await db
    .select({ id: clients.id, setupFlags: clients.setupFlags })
    .from(clients)
    .where(and(match, isNull(clients.deletedAt)))
    .limit(1);
  if (!client) return { clientId: null, screen: pass };

  const key = normalizeForBlock(info.fromNumber);
  if (!key) return { clientId: client.id, screen: pass };
  const blocked = client.setupFlags?.blockedNumbers ?? [];
  // Blocked: no need to read the log.
  if (isBlocked(key, blocked))
    return { clientId: client.id, screen: { reject: true, reason: "blocked" } };

  const since = new Date(now.getTime() - SCREEN_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const history = await db
    .select({
      outcome: calls.outcome,
      // Spelled out: inside a one-table select drizzle drops the table prefix,
      // and an unqualified "id" in the subquery would mean the lead's own id.
      hasContact: sql<boolean>`(exists (select 1 from "leads" l where l.call_id = "calls"."id")
        or exists (select 1 from "appointments" a where a.call_id = "calls"."id"))`,
    })
    .from(calls)
    .where(
      and(
        eq(calls.clientId, client.id),
        isNull(calls.deletedAt),
        gte(calls.startAt, since),
        sql`right(regexp_replace(coalesce(${calls.fromNumber}, ''), '\\D', '', 'g'), 10) = ${key}`,
      ),
    )
    .orderBy(desc(calls.startAt))
    .limit(50);

  return {
    clientId: client.id,
    screen: screenInboundCaller(
      info.fromNumber,
      blocked,
      history,
      client.setupFlags?.allowedNumbers ?? [],
    ),
  };
}

/**
 * Note a call the screen turned away, so the owner can see it (rejected calls
 * leave no row in `calls`). One atomic UPDATE: the new entry goes first, the
 * list keeps the last SCREEN_WINDOW_DAYS and at most MAX_TURNED_AWAY entries,
 * and a Retell retry with the same call_id is a no-op. It only touches the
 * `turnedAway` key, so it can't undo a block or any other setting saved at
 * the same moment.
 */
export async function recordTurnedAway(
  clientId: string,
  entry: { phone: string; reason: InboundScreenReason; callId?: string | null },
  now = new Date(),
): Promise<void> {
  const item: TurnedAwayEntry = {
    at: now.toISOString(),
    phone: entry.phone,
    reason: entry.reason,
    ...(entry.callId ? { callId: entry.callId } : {}),
  };
  const since = new Date(now.getTime() - SCREEN_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const existing = sql`coalesce(${clients.setupFlags} -> 'turnedAway', '[]'::jsonb)`;
  await db
    .update(clients)
    .set({
      setupFlags: sql`jsonb_set(
        coalesce(${clients.setupFlags}, '{}'::jsonb),
        '{turnedAway}',
        (select coalesce(jsonb_agg(e.value order by e.ord), '[]'::jsonb)
           from (select value, ord
                   from jsonb_array_elements(${JSON.stringify([item])}::jsonb || ${existing})
                        with ordinality as t(value, ord)
                  where (value ->> 'at') >= ${since}
                  order by ord
                  limit ${MAX_TURNED_AWAY}) e),
        true)`,
      // Bookkeeping, not an edit: keep updated_at as it was (retention.ts reads it).
      updatedAt: sql`${clients.updatedAt}`,
    })
    .where(
      and(
        eq(clients.id, clientId),
        item.callId
          ? sql`not (${existing} @> ${JSON.stringify([{ callId: item.callId }])}::jsonb)`
          : sql`true`,
      ),
    );
}
