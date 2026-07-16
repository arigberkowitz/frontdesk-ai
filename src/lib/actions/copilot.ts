"use server";

import { z } from "zod";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { agentRuns } from "@/db/schema";
import { resolvePortalClient } from "@/lib/auth-guard";
import { runCopilot, type CopilotMessage } from "@/lib/agents/copilot";

const historySchema = z
  .array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string().max(4000),
    }),
  )
  .max(24);

export interface CopilotState {
  reply: string | null;
  error?: string;
}

/**
 * Durable per-client throttle, backed by agent_runs (kind "copilot_chat", one
 * row per exchange). Each exchange runs up to MAX_TURNS model calls, so
 * unthrottled spam gets expensive fast. Postgres makes the limit hold across
 * serverless instances — no Redis needed — and the rows double as usage
 * analytics. Fail-open on a lagging migration (in-memory fallback below).
 */
const MIN_GAP_MS = 3000;
const MAX_PER_DAY = 60;
const memLastCall = new Map<string, number>();

async function throttled(clientId: string): Promise<string | null> {
  // Cheap same-instance gap check first (saves a query on double-clicks).
  const now = Date.now();
  if (now - (memLastCall.get(clientId) ?? 0) < MIN_GAP_MS) {
    return "One question at a time — give me a second.";
  }
  memLastCall.set(clientId, now);

  try {
    const dayAgo = new Date(now - 24 * 3600 * 1000);
    const [row] = await db
      .select({
        n: sql<number>`count(*)::int`,
        last: sql<Date | null>`max(${agentRuns.startedAt})`,
      })
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.clientId, clientId),
          eq(agentRuns.kind, "copilot_chat"),
          gte(agentRuns.startedAt, dayAgo),
        ),
      );
    if ((row?.n ?? 0) >= MAX_PER_DAY) {
      return "You've hit today's assistant limit — try again tomorrow.";
    }
    if (row?.last && now - new Date(row.last).getTime() < MIN_GAP_MS) {
      return "One question at a time — give me a second.";
    }
    await db.insert(agentRuns).values({
      clientId,
      kind: "copilot_chat",
      status: "succeeded",
      finishedAt: new Date(),
    });
    return null;
  } catch {
    // Migration lag: fall back to the in-memory gap check alone.
    return null;
  }
}

/** One copilot exchange. Tenancy: the clientId comes from the session, never the form. */
export async function copilotAction(
  _prev: CopilotState,
  formData: FormData,
): Promise<CopilotState> {
  const { clientId } = await resolvePortalClient();

  const question = String(formData.get("question") ?? "").trim().slice(0, 1000);
  if (!question) return { reply: null, error: "Ask something first." };

  const limit = await throttled(clientId);
  if (limit) return { reply: null, error: limit };

  let history: CopilotMessage[] = [];
  try {
    history = historySchema.parse(JSON.parse(String(formData.get("history") ?? "[]")));
  } catch {
    history = [];
  }

  const reply = await runCopilot(clientId, [...history, { role: "user", content: question }]);
  return { reply };
}
