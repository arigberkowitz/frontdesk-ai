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
  return (await startChatTurn(clientId, null)).ok;
}

/**
 * Same cap as allowChatTurn, and returns the turn's row so the route can
 * record what the turn produced (recordChatTurnOutcome). The row's `stats`
 * carries the widget's per-page conversation id, which is what "chats" on the
 * dashboard counts. No new table and no migration: the rows already exist for
 * the cap.
 */
export async function startChatTurn(
  clientId: string,
  conversationId: string | null,
): Promise<{ ok: boolean; runId: string | null }> {
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
      return { ok: false, runId: null };
    }
    const [inserted] = await db
      .insert(agentRuns)
      .values({
        clientId,
        kind: "web_chat_turn",
        status: "succeeded",
        finishedAt: new Date(),
        stats: conversationId ? { conversation: conversationId } : null,
      })
      .returning({ id: agentRuns.id });
    return { ok: true, runId: inserted?.id ?? null };
  } catch {
    return { ok: consumeAttempt(`chat-turns:${clientId}`, CHAT_TURNS_PER_CLIENT_PER_DAY, DAY_MS).ok, runId: null };
  }
}

/**
 * What one chat turn produced: a lead taken (take_message succeeded) and/or a
 * booking made (book_appointment succeeded). Counted only from tool results
 * that said success, never from what the model wrote. Best effort: a failed
 * write loses a dashboard count, never the visitor's reply.
 */
export async function recordChatTurnOutcome(
  clientId: string,
  runId: string | null,
  outcome: { leads: number; bookings: number },
): Promise<void> {
  if (!runId || (outcome.leads <= 0 && outcome.bookings <= 0)) return;
  try {
    const patch = JSON.stringify({ leads: outcome.leads, bookings: outcome.bookings });
    await db
      .update(agentRuns)
      .set({ stats: sql`coalesce(${agentRuns.stats}, '{}'::jsonb) || ${patch}::jsonb` })
      .where(and(eq(agentRuns.id, runId), eq(agentRuns.clientId, clientId)));
  } catch (err) {
    logger.warn("chat.outcome_record_failed", { clientId, error: err instanceof Error ? err.message : String(err) });
  }
}

export interface WebChatStats {
  days: number;
  /** Distinct widget conversations that reached the model. */
  chats: number;
  /** Leads the chat captured (take_message succeeded). */
  leads: number;
  /** Bookings the chat made (book_appointment succeeded). */
  bookings: number;
}

/**
 * Website chat numbers for the dashboard, from the same agent_runs rows. Null
 * when they can't be read (e.g. the web_chat_turn enum migration hasn't run),
 * so the dashboard says nothing rather than showing a made-up zero.
 */
export async function getWebChatStats(clientId: string, days = 30): Promise<WebChatStats | null> {
  try {
    const since = new Date(Date.now() - days * DAY_MS);
    const [row] = await db
      .select({
        chats: sql<number>`count(distinct ${agentRuns.stats}->>'conversation')::int`,
        leads: sql<number>`coalesce(sum((${agentRuns.stats}->>'leads')::int), 0)::int`,
        bookings: sql<number>`coalesce(sum((${agentRuns.stats}->>'bookings')::int), 0)::int`,
      })
      .from(agentRuns)
      .where(
        and(eq(agentRuns.clientId, clientId), eq(agentRuns.kind, "web_chat_turn"), gte(agentRuns.startedAt, since)),
      );
    return { days, chats: row?.chats ?? 0, leads: row?.leads ?? 0, bookings: row?.bookings ?? 0 };
  } catch {
    return null;
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
