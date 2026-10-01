import "server-only";
import { and, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { smsMessages, smsThreads, type SmsThreadRow } from "@/db/schema";
import { customerKeyFor } from "@/lib/data/sms-messages";
import { PORTAL_REPLY_KIND } from "@/lib/sms-reply";
import { AI_HANDOFF_KIND, AI_REPLY_KIND } from "@/lib/sms-ai/rules";
import { logger } from "@/lib/logger";

/**
 * Per-conversation AI state (sms_threads). Every function takes the business's
 * `clientId` and scopes on it (§12). Reads that back a SEND decision throw on
 * error (a guard that can't check must not pass); the thread page's read is
 * the only one that swallows errors (migration lag shouldn't 500 the page).
 */

const DAY_MS = 24 * 3600 * 1000;
/** How long one AI run may hold a thread. */
const BUSY_MS = 90_000;

export async function getThreadState(clientId: string, customerPhone: string): Promise<SmsThreadRow | null> {
  const key = customerKeyFor(customerPhone);
  if (!key) return null;
  const row = await db.query.smsThreads.findFirst({
    where: and(eq(smsThreads.clientId, clientId), eq(smsThreads.customerPhone, key)),
  });
  return row ?? null;
}

/** Same as getThreadState but never throws (page rendering). */
export async function getThreadStateSafe(clientId: string, customerPhone: string): Promise<SmsThreadRow | null> {
  try {
    return await getThreadState(clientId, customerPhone);
  } catch {
    return null;
  }
}

/** Pause (owner button / AI handoff) or resume AI replies in one thread. */
export async function setThreadAiPaused(
  clientId: string,
  customerPhone: string,
  paused: boolean,
  reason: string | null,
): Promise<void> {
  const key = customerKeyFor(customerPhone);
  if (!key) return;
  const now = new Date();
  const patch = paused
    ? { aiPaused: true, aiPausedReason: reason, aiPausedAt: now, updatedAt: now }
    : { aiPaused: false, aiPausedReason: null, aiPausedAt: null, aiResumedAt: now, updatedAt: now };
  await db
    .insert(smsThreads)
    .values({ clientId, customerPhone: key, ...patch })
    .onConflictDoUpdate({ target: [smsThreads.clientId, smsThreads.customerPhone], set: patch });
}

/**
 * Claim the thread for one AI run. Returns false if another run holds it
 * (two texts arriving together). The claim expires on its own, so a crashed
 * run can't wedge a thread.
 */
export async function claimThreadForAi(clientId: string, customerPhone: string): Promise<boolean> {
  const key = customerKeyFor(customerPhone);
  if (!key) return false;
  const now = new Date();
  const until = new Date(now.getTime() + BUSY_MS);
  await db
    .insert(smsThreads)
    .values({ clientId, customerPhone: key })
    .onConflictDoNothing({ target: [smsThreads.clientId, smsThreads.customerPhone] });
  const claimed = await db
    .update(smsThreads)
    .set({ aiBusyUntil: until, updatedAt: now })
    .where(
      and(
        eq(smsThreads.clientId, clientId),
        eq(smsThreads.customerPhone, key),
        or(isNull(smsThreads.aiBusyUntil), lt(smsThreads.aiBusyUntil, now)),
      ),
    )
    .returning({ id: smsThreads.id });
  return claimed.length > 0;
}

export async function releaseThreadForAi(clientId: string, customerPhone: string): Promise<void> {
  const key = customerKeyFor(customerPhone);
  if (!key) return;
  try {
    await db
      .update(smsThreads)
      .set({ aiBusyUntil: null })
      .where(and(eq(smsThreads.clientId, clientId), eq(smsThreads.customerPhone, key)));
  } catch (err) {
    logger.warn("sms_ai.release_failed", { clientId, error: err instanceof Error ? err.message : String(err) });
  }
}

/** Most recent owner/staff reply typed in the portal for this thread. Throws on error. */
export async function lastOwnerReplyAt(clientId: string, customerPhone: string): Promise<Date | null> {
  const key = customerKeyFor(customerPhone);
  if (!key) return null;
  const [row] = await db
    .select({ at: smsMessages.createdAt })
    .from(smsMessages)
    .where(
      and(
        eq(smsMessages.clientId, clientId),
        eq(smsMessages.customerPhone, key),
        eq(smsMessages.direction, "outbound"),
        eq(smsMessages.kind, PORTAL_REPLY_KIND),
      ),
    )
    .orderBy(desc(smsMessages.createdAt))
    .limit(1);
  return row?.at ?? null;
}

/** AI-sent texts in the last 24h, for this business and this thread. Throws on error. */
export async function countAiSentToday(
  clientId: string,
  customerPhone: string,
): Promise<{ client: number; thread: number }> {
  const key = customerKeyFor(customerPhone) ?? "";
  const [row] = await db
    .select({
      client: sql<number>`count(*)`.mapWith(Number),
      thread: sql<number>`count(*) filter (where ${smsMessages.customerPhone} = ${key})`.mapWith(Number),
    })
    .from(smsMessages)
    .where(
      and(
        eq(smsMessages.clientId, clientId),
        eq(smsMessages.direction, "outbound"),
        inArray(smsMessages.kind, [AI_REPLY_KIND, AI_HANDOFF_KIND]),
        gte(smsMessages.createdAt, new Date(Date.now() - DAY_MS)),
      ),
    );
  return { client: Number(row?.client ?? 0), thread: Number(row?.thread ?? 0) };
}

/** Id of the newest inbound message in the thread (to skip stale runs). Throws on error. */
export async function latestInboundId(clientId: string, customerPhone: string): Promise<string | null> {
  const key = customerKeyFor(customerPhone);
  if (!key) return null;
  const [row] = await db
    .select({ id: smsMessages.id })
    .from(smsMessages)
    .where(
      and(
        eq(smsMessages.clientId, clientId),
        eq(smsMessages.customerPhone, key),
        eq(smsMessages.direction, "inbound"),
      ),
    )
    .orderBy(desc(smsMessages.createdAt), desc(smsMessages.id))
    .limit(1);
  return row?.id ?? null;
}
