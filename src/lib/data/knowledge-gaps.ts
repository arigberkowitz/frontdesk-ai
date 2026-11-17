import "server-only";
import { and, desc, eq, gte, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { agentSuggestions, callKnowledgeGaps, calls, knowledgeItems } from "@/db/schema";
import { cleanGapQuestions, summarizeGaps, type GapSummary } from "@/lib/knowledge-gaps";
import { logger } from "@/lib/logger";

/**
 * Knowledge-gap data access. Every read and write here is fail-soft: the table
 * arrives by a manual migration (drizzle/manual/0023), and code that ships
 * first must not break post-call extraction or the portal overview.
 * Callers verify client→org ownership first.
 */

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Record one checked call (idempotent per call). Empty list = nothing missed. */
export async function recordKnowledgeGaps(input: {
  callId: string;
  clientId: string;
  questions: unknown;
}): Promise<void> {
  try {
    await db
      .insert(callKnowledgeGaps)
      .values({
        callId: input.callId,
        clientId: input.clientId,
        questions: cleanGapQuestions(input.questions),
      })
      .onConflictDoNothing({ target: callKnowledgeGaps.callId });
  } catch (err) {
    logger.warn("knowledge_gaps.save_failed", { callId: input.callId, error: errMsg(err) });
  }
}

/**
 * Recent distinct gap questions for a business, newest first. Handed to the
 * extraction model so the same question gets the same wording across calls,
 * which is what makes the counts group.
 */
export async function recentGapQuestions(clientId: string, limit = 15): Promise<string[]> {
  try {
    const rows = await db
      .select({ questions: callKnowledgeGaps.questions })
      .from(callKnowledgeGaps)
      .where(
        and(
          eq(callKnowledgeGaps.clientId, clientId),
          sql`jsonb_array_length(${callKnowledgeGaps.questions}) > 0`,
        ),
      )
      .orderBy(desc(callKnowledgeGaps.createdAt))
      .limit(50);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of rows) {
      for (const q of r.questions ?? []) {
        const key = q.trim().toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(q);
        if (out.length >= limit) return out;
      }
    }
    return out;
  } catch (err) {
    logger.warn("knowledge_gaps.recent_failed", { clientId, error: errMsg(err) });
    return [];
  }
}

/**
 * The owner's card: of the calls checked in the last `days` days (by call
 * start, spam and deleted calls excluded), how many had a question the AI
 * couldn't answer, and the most-asked ones. Null when the table isn't there
 * yet, so the card hides instead of showing a made-up zero.
 */
export async function getKnowledgeGapSummary(
  clientId: string,
  days = 30,
): Promise<GapSummary | null> {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);
  try {
    const [rows, knowledge, open] = await Promise.all([
      db
        .select({ callId: callKnowledgeGaps.callId, questions: callKnowledgeGaps.questions })
        .from(callKnowledgeGaps)
        .innerJoin(calls, eq(calls.id, callKnowledgeGaps.callId))
        .where(
          and(
            eq(callKnowledgeGaps.clientId, clientId),
            eq(calls.clientId, clientId),
            isNull(calls.deletedAt),
            gte(calls.startAt, since),
            or(isNull(calls.outcome), ne(calls.outcome, "spam")),
          ),
        ),
      db
        .select({ question: knowledgeItems.question })
        .from(knowledgeItems)
        .where(and(eq(knowledgeItems.clientId, clientId), isNull(knowledgeItems.deletedAt))),
      db
        .select({
          id: agentSuggestions.id,
          question: agentSuggestions.question,
          evidence: agentSuggestions.evidence,
        })
        .from(agentSuggestions)
        .where(
          and(
            eq(agentSuggestions.clientId, clientId),
            eq(agentSuggestions.status, "proposed"),
            eq(agentSuggestions.type, "knowledge"),
          ),
        ),
    ]);
    return summarizeGaps(
      rows.map((r) => ({ callId: r.callId, questions: Array.isArray(r.questions) ? r.questions : [] })),
      {
        knowledgeQuestions: knowledge.map((k) => k.question),
        suggestions: open.map((s) => {
          const ev = s.evidence as { callIds?: unknown } | null;
          return {
            id: s.id,
            question: s.question,
            callIds: Array.isArray(ev?.callIds)
              ? ev.callIds.filter((x): x is string => typeof x === "string")
              : [],
          };
        }),
      },
    );
  } catch (err) {
    logger.warn("knowledge_gaps.summary_failed", { clientId, error: errMsg(err) });
    return null;
  }
}
