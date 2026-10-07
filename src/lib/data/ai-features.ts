import "server-only";
import { and, desc, eq, gte, like, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { notifications, rebookOffers, smsMessages, smsThreads } from "@/db/schema";
import { callbackStats } from "@/lib/data/call-callbacks";
import { DAILY_BRIEFING_KIND } from "@/lib/data/daily-briefing";
import { AI_REPLY_KIND } from "@/lib/sms-ai/rules";
import type { AiFeatureStats } from "@/lib/ai-features";

/**
 * Recent counts behind the Overview "AI features" switchboard. Every query is
 * scoped by client_id and indexed; each one fails soft to `null` (unknown, so
 * the card says nothing) instead of breaking the Overview — e.g. before a
 * feature's migration has run.
 */
export async function getAiFeatureStats(
  clientId: string,
  enabled: { aiTextReplies: boolean; missedCallTexts: boolean; smartRebooking: boolean; dailyBriefing: boolean },
  now: Date = new Date(),
): Promise<AiFeatureStats> {
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const monthAgo = new Date(now.getTime() - 30 * 86_400_000);
  const soft = <T,>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

  // Only ask for what an "on" feature will show — an off feature shows no numbers.
  const [aiReplies7d, aiHandoffs7d, callbacks, rebook, briefing] = await Promise.all([
    enabled.aiTextReplies
      ? soft(
          db
            .select({ n: sql<number>`count(*)::int` })
            .from(smsMessages)
            .where(
              and(
                eq(smsMessages.clientId, clientId),
                eq(smsMessages.direction, "outbound"),
                eq(smsMessages.kind, AI_REPLY_KIND),
                ne(smsMessages.status, "failed"),
                gte(smsMessages.createdAt, weekAgo),
              ),
            )
            .then((r) => r[0]?.n ?? 0),
        )
      : null,
    enabled.aiTextReplies
      ? soft(
          db
            .select({ n: sql<number>`count(*)::int` })
            .from(smsThreads)
            .where(
              and(
                eq(smsThreads.clientId, clientId),
                like(smsThreads.aiPausedReason, "handoff:%"),
                gte(smsThreads.aiPausedAt, weekAgo),
              ),
            )
            .then((r) => r[0]?.n ?? 0),
        )
      : null,
    enabled.missedCallTexts ? soft(callbackStats(clientId, 7)) : null,
    enabled.smartRebooking
      ? soft(
          db
            .select({
              sent: sql<number>`count(*) filter (where ${rebookOffers.sentAt} is not null)::int`,
              rebooked: sql<number>`count(*) filter (where ${rebookOffers.status} = 'rescheduled')::int`,
            })
            .from(rebookOffers)
            .where(and(eq(rebookOffers.clientId, clientId), gte(rebookOffers.createdAt, monthAgo)))
            .then((r) => r[0] ?? { sent: 0, rebooked: 0 }),
        )
      : null,
    enabled.dailyBriefing
      ? soft(
          db
            .select({ sentAt: notifications.sentAt })
            .from(notifications)
            .where(
              and(
                eq(notifications.clientId, clientId),
                eq(notifications.type, "digest_daily"),
                eq(notifications.status, "sent"),
                sql`${notifications.payload}->>'kind' = ${DAILY_BRIEFING_KIND}`,
              ),
            )
            .orderBy(desc(notifications.sentAt))
            .limit(1)
            .then((r) => r[0]?.sentAt ?? null),
        )
      : null,
  ]);

  return {
    aiReplies7d,
    aiHandoffs7d,
    callbacks7d: callbacks
      ? {
          sent: callbacks.sent,
          pending: callbacks.pending,
          failed: callbacks.failed,
        }
      : null,
    rebook30d: rebook,
    lastBriefingSentAt: briefing,
  };
}
