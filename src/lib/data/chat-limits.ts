import "server-only";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { agentRuns } from "@/db/schema";
import { normalizePhone } from "./sms-optouts";
import { consumeAttempt } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

/**
 * Durable spend/abuse caps for the public website chat.
 *
 * The chat is anonymous and scriptable, and the in-memory per-IP limiter
 * counts per warm serverless instance, so on its own it bounds nothing. These
 * caps live in Postgres (rows in `agent_runs`, the same pattern as the portal
 * copilot's limiter) so they hold across instances and IPs:
 *
 * - `allowChatTurn`: visitor messages per business per day (model spend).
 * - `allowChatSms`: customer texts the chat can trigger — per destination
 *   number per day, and per business per day. This is the one that matters
 *   most: without it, anyone could make a business's number text strangers.
 *
 * If the enum migration (drizzle/manual/0006_web_chat_limits.sql, applied via
 * `npm run db:push`) hasn't landed yet, both fall back to an in-memory count
 * with the same limits rather than failing open entirely.
 */

export const CHAT_TURNS_PER_CLIENT_PER_DAY = 300;
export const CHAT_SMS_PER_PHONE_PER_DAY = 3;
export const CHAT_SMS_PER_CLIENT_PER_DAY = 40;

const DAY_MS = 24 * 3600 * 1000;

export type ChatSmsPurpose = "booking_confirmation" | "cancel_code" | "deposit_request";

/** One visitor message. False once the business hit today's cap. */
export async function allowChatTurn(clientId: string): Promise<boolean> {
  try {
    const since = new Date(Date.now() - DAY_MS);
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(agentRuns)
      .where(
        and(eq(agentRuns.clientId, clientId), eq(agentRuns.kind, "web_chat_turn"), gte(agentRuns.startedAt, since)),
      );
    if ((row?.n ?? 0) >= CHAT_TURNS_PER_CLIENT_PER_DAY) {
      logger.warn("chat.limit.client_daily_turns", { clientId });
      return false;
    }
    await db.insert(agentRuns).values({
      clientId,
      kind: "web_chat_turn",
      status: "succeeded",
      finishedAt: new Date(),
    });
    return true;
  } catch {
    return consumeAttempt(`chat-turns:${clientId}`, CHAT_TURNS_PER_CLIENT_PER_DAY, DAY_MS).ok;
  }
}

/**
 * May the chat send one customer text to `phone` for this business? Records
 * the send when it says yes. Call it immediately before sending.
 */
export async function allowChatSms(
  clientId: string,
  phone: string,
  purpose: ChatSmsPurpose,
): Promise<boolean> {
  const to = normalizePhone(phone);
  if (!to) return false;
  try {
    const since = new Date(Date.now() - DAY_MS);
    const [row] = await db
      .select({
        client: sql<number>`count(*)::int`,
        phone: sql<number>`count(*) filter (where ${agentRuns.stats}->>'phone' = ${to})::int`,
      })
      .from(agentRuns)
      .where(
        and(eq(agentRuns.clientId, clientId), eq(agentRuns.kind, "web_chat_sms"), gte(agentRuns.startedAt, since)),
      );
    if ((row?.phone ?? 0) >= CHAT_SMS_PER_PHONE_PER_DAY || (row?.client ?? 0) >= CHAT_SMS_PER_CLIENT_PER_DAY) {
      logger.warn("chat.limit.sms", { clientId, purpose });
      return false;
    }
    await db.insert(agentRuns).values({
      clientId,
      kind: "web_chat_sms",
      status: "succeeded",
      finishedAt: new Date(),
      stats: { phone: to, purpose },
    });
    return true;
  } catch {
    const perPhone = consumeAttempt(`chat-sms:${clientId}:${to}`, CHAT_SMS_PER_PHONE_PER_DAY, DAY_MS).ok;
    const perClient = perPhone && consumeAttempt(`chat-sms:${clientId}`, CHAT_SMS_PER_CLIENT_PER_DAY, DAY_MS).ok;
    return perPhone && perClient;
  }
}
