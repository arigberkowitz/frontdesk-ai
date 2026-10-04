import "server-only";
import { and, eq, gte, inArray, isNotNull, isNull, lte, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  agentRuns,
  agentSuggestions,
  callGrades,
  clients,
  leads,
  reminders,
  smsMessages,
} from "@/db/schema";
import { logger } from "@/lib/logger";
import {
  buildTodayInbox,
  EMPTY_INBOX_COUNTS,
  type ClientCount,
  type InboxCounts,
  type InboxItem,
} from "@/lib/today-inbox";

/**
 * Counts behind the operator's Today inbox. One grouped COUNT per source, all
 * scoped to the operator's org (§12) through its client ids, over existing
 * tables and indexes — no new storage.
 *
 * Fail-soft per source: these run on the dashboard, so a lagging migration on
 * one table (e.g. sms_messages) drops that line, never the page.
 */

export const INBOX_WINDOW_DAYS = 7;

/** Agent-run kinds that are throttle/analytics rows (one per chat message), not jobs. */
const NON_JOB_RUN_KINDS = ["copilot_chat", "web_chat_turn", "web_chat_sms"] as const;

async function safe<T>(label: string, q: () => Promise<T[]>): Promise<T[]> {
  try {
    return await q();
  } catch (err) {
    logger.warn("today_inbox.query_failed", {
      source: label,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

const n = sql<number>`count(*)::int`;

export async function getTodayInboxCounts(
  clientIds: string[],
  now: Date = new Date(),
): Promise<InboxCounts> {
  if (clientIds.length === 0) return EMPTY_INBOX_COUNTS;
  const since = new Date(now.getTime() - INBOX_WINDOW_DAYS * 86_400_000);
  const horizon = new Date(now.getTime() + INBOX_WINDOW_DAYS * 86_400_000);

  const [newLeads, unreadThreads, proposedFixes, openGrades, trialsEnding, failedReminders, failedTexts, failedRuns] =
    await Promise.all([
      safe<ClientCount>("leads", () =>
        db
          .select({ clientId: leads.clientId, count: n })
          .from(leads)
          .where(and(inArray(leads.clientId, clientIds), eq(leads.status, "new"), isNull(leads.deletedAt)))
          .groupBy(leads.clientId),
      ),
      safe<ClientCount>("sms_unread", () =>
        db
          .select({ clientId: smsMessages.clientId, count: sql<number>`count(distinct ${smsMessages.customerPhone})::int` })
          .from(smsMessages)
          .where(
            and(
              inArray(smsMessages.clientId, clientIds),
              eq(smsMessages.direction, "inbound"),
              isNull(smsMessages.readAt),
            ),
          )
          .groupBy(smsMessages.clientId),
      ),
      safe<ClientCount>("suggestions", () =>
        db
          .select({ clientId: agentSuggestions.clientId, count: n })
          .from(agentSuggestions)
          .where(and(inArray(agentSuggestions.clientId, clientIds), eq(agentSuggestions.status, "proposed")))
          .groupBy(agentSuggestions.clientId),
      ),
      safe<ClientCount>("grades", () =>
        db
          .select({ clientId: callGrades.clientId, count: n })
          .from(callGrades)
          .where(and(inArray(callGrades.clientId, clientIds), eq(callGrades.status, "open")))
          .groupBy(callGrades.clientId),
      ),
      safe<{ clientId: string; trialEndsAt: Date }>("trials", async () => {
        const rows = await db
          .select({ clientId: clients.id, trialEndsAt: clients.trialEndsAt })
          .from(clients)
          .where(
            and(
              inArray(clients.id, clientIds),
              eq(clients.status, "trial"),
              isNotNull(clients.trialEndsAt),
              // Ending within the window — and ones already past their end
              // that are somehow still on trial, which need a decision most.
              lte(clients.trialEndsAt, horizon),
              isNull(clients.deletedAt),
            ),
          );
        return rows.map((r) => ({ clientId: r.clientId, trialEndsAt: r.trialEndsAt! }));
      }),
      safe<ClientCount>("reminders_failed", () =>
        db
          .select({ clientId: reminders.clientId, count: n })
          .from(reminders)
          .where(
            and(inArray(reminders.clientId, clientIds), eq(reminders.status, "failed"), gte(reminders.createdAt, since)),
          )
          .groupBy(reminders.clientId),
      ),
      safe<ClientCount>("sms_failed", () =>
        db
          .select({ clientId: smsMessages.clientId, count: n })
          .from(smsMessages)
          .where(
            and(
              inArray(smsMessages.clientId, clientIds),
              eq(smsMessages.direction, "outbound"),
              eq(smsMessages.status, "failed"),
              gte(smsMessages.createdAt, since),
            ),
          )
          .groupBy(smsMessages.clientId),
      ),
      safe<ClientCount>("agent_runs_failed", () =>
        db
          .select({ clientId: agentRuns.clientId, count: n })
          .from(agentRuns)
          .where(
            and(
              inArray(agentRuns.clientId, clientIds),
              eq(agentRuns.status, "failed"),
              gte(agentRuns.startedAt, since),
              notInArray(agentRuns.kind, [...NON_JOB_RUN_KINDS]),
            ),
          )
          .groupBy(agentRuns.clientId),
      ),
    ]);

  return { newLeads, unreadThreads, proposedFixes, openGrades, trialsEnding, failedReminders, failedTexts, failedRuns };
}

/** The Today inbox for an operator's org: every (non-deleted) client's open items. */
export async function getTodayInbox(
  orgId: string,
  now: Date = new Date(),
): Promise<{ items: InboxItem[]; total: number }> {
  const orgClients = await safe("clients", () =>
    db
      .select({ id: clients.id, name: clients.name })
      .from(clients)
      .where(and(eq(clients.orgId, orgId), isNull(clients.deletedAt))),
  );
  const counts = await getTodayInboxCounts(
    orgClients.map((c) => c.id),
    now,
  );
  return buildTodayInbox(orgClients, counts, now);
}
