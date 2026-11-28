import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { calls, clients } from "@/db/schema";
import { numberGate, type NumberGate, type NumberGateFacts } from "@/lib/number-gate";

/**
 * Numbers bought for unpaid trials in the last 24 hours, across every business.
 * `trialNumberAt` is stamped by runProvision when a trial unlock buys one.
 */
export async function trialNumbersBoughtToday(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(clients)
    .where(sql`(${clients.setupFlags}->>'trialNumberAt')::timestamptz > now() - interval '24 hours'`);
  return Number(row?.n ?? 0);
}

/** Whether this business may be given its own phone number (see number-gate.ts). */
export async function getNumberGate(
  clientId: string,
  actorRole: NumberGateFacts["actorRole"],
): Promise<NumberGate & { trialEndsAt: Date | null }> {
  const client = await db.query.clients.findFirst({
    where: and(eq(clients.id, clientId), isNull(clients.deletedAt)),
    with: { subscription: true },
  });
  if (!client) return { unlocked: false, via: null, reason: "needs_plan", trialEndsAt: null };
  if (actorRole === "operator") {
    return { unlocked: true, via: "operator", reason: null, trialEndsAt: client.trialEndsAt ?? null };
  }
  const sub = client.subscription && !client.subscription.deletedAt ? client.subscription : null;
  const [testCall] = await db
    .select({ id: calls.id })
    .from(calls)
    .where(eq(calls.clientId, clientId))
    .limit(1);
  const gate = numberGate({
    actorRole,
    status: client.status,
    comped: Boolean(client.setupFlags?.comped),
    subscriptionStatus: sub?.status ?? null,
    firstPaid: Boolean(sub?.firstPaidAt),
    trialEndsAt: client.trialEndsAt ?? null,
    trialLapsed: Boolean(client.setupFlags?.trialLapsedAt),
    trialApproved: Boolean(client.setupFlags?.trialApprovedAt),
    hasTestCall: Boolean(testCall),
    trialNumbersToday: client.status === "trial" ? await trialNumbersBoughtToday() : 0,
  });
  return { ...gate, trialEndsAt: client.trialEndsAt ?? null };
}
