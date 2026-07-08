import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { and, eq, gte, inArray, isNull, isNotNull, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { agentRuns, calls, callGrades, clients, type Client } from "@/db/schema";
import { CRITIC_MODEL, getAnthropic, toolInput } from "./anthropic";
import { logger } from "@/lib/logger";

/**
 * Agent #3 — QA / supervisor. Batch-grades recent calls: a 1–5 score, defect
 * flags, and a one-line coaching note. Low scores and compliance risks land in
 * the operator's /review queue; the flags also feed agent #1's nightly loop
 * (improve.ts reads call_grades when drafting fixes).
 */

export const QA_FLAGS = [
  "missed_booking",
  "wrong_or_vague_answer",
  "fallback_used",
  "caller_frustrated",
  "hours_or_price_error",
  "transfer_failed",
  "compliance_risk",
] as const;

const MAX_CALLS_PER_CLIENT = 25;

const GRADE_TOOL: Anthropic.Tool = {
  name: "grade_call",
  description: "Grade how well the AI receptionist handled this call.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      score: {
        type: "integer",
        minimum: 1,
        maximum: 5,
        description:
          "5 = flawless; 4 = minor rough edge; 3 = adequate but a clear miss; 2 = caller poorly served; 1 = failure (lost booking, wrong info, upset caller).",
      },
      flags: {
        type: "array",
        items: { type: "string", enum: QA_FLAGS as unknown as string[] },
        description: "Every defect that occurred. Empty if none.",
      },
      complianceRisk: {
        type: "boolean",
        description:
          "True if the AI made promises it shouldn't (prices/outcomes not in its data), mishandled recording disclosure, or gave advice with legal exposure.",
      },
      coachingNote: {
        type: "string",
        description: "One sentence for the operator: what went wrong and what would fix it. Empty if score is 4–5 with no flags.",
      },
    },
    required: ["score", "flags", "complianceRisk", "coachingNote"],
  },
};

const gradeSchema = z.object({
  score: z.coerce.number().int().min(1).max(5),
  flags: z.array(z.enum(QA_FLAGS)).default([]),
  complianceRisk: z.coerce.boolean().default(false),
  coachingNote: z.string().default(""),
});

async function gradeCall(
  anthropic: Anthropic,
  client: Client,
  call: { id: string; transcript: string; outcome: string | null },
): Promise<z.infer<typeof gradeSchema> | null> {
  try {
    const res = await anthropic.messages.create({
      model: CRITIC_MODEL,
      max_tokens: 500,
      system:
        "You are the QA supervisor for an AI phone receptionist serving local businesses. Grade the receptionist's performance on this call — not the caller's mood. Judge: did it answer accurately, book when bookable, capture the lead when it couldn't book, stay on-policy, and keep the caller comfortable? Be strict but fair; most competent calls are a 4.",
      messages: [
        {
          role: "user",
          content: `Business: ${client.name}${client.industry ? ` (${client.industry})` : ""}
Recorded outcome: ${call.outcome ?? "unknown"}

Transcript:
${call.transcript.slice(0, 6000)}`,
        },
      ],
      tools: [GRADE_TOOL],
      tool_choice: { type: "tool", name: GRADE_TOOL.name },
    });
    const parsed = gradeSchema.safeParse(toolInput(res));
    return parsed.success ? parsed.data : null;
  } catch (err) {
    logger.warn("agents.qa.grade_failed", {
      callId: call.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export interface QaResult {
  clientId: string;
  clientName: string;
  graded: number;
  flagged: number;
  skipped?: string;
}

/** Grade one client's ungraded recent calls. */
export async function qaReviewClient(client: Client, sinceHours = 24): Promise<QaResult> {
  const base: QaResult = { clientId: client.id, clientName: client.name, graded: 0, flagged: 0 };
  const anthropic = getAnthropic();
  if (!anthropic) return { ...base, skipped: "anthropic_unconfigured" };

  const since = new Date(Date.now() - sinceHours * 3600 * 1000);
  const graded = await db
    .select({ callId: callGrades.callId })
    .from(callGrades)
    .where(eq(callGrades.clientId, client.id));
  const gradedIds = graded.map((g) => g.callId);

  const rows = await db.query.calls.findMany({
    where: and(
      eq(calls.clientId, client.id),
      isNull(calls.deletedAt),
      isNotNull(calls.transcript),
      gte(calls.startAt, since),
      gradedIds.length ? notInArray(calls.id, gradedIds) : undefined,
    ),
    orderBy: (c, { desc }) => [desc(c.startAt)],
    limit: MAX_CALLS_PER_CLIENT,
  });
  const candidates = rows.filter((r) => (r.transcript ?? "").trim().length > 0);
  if (candidates.length === 0) return { ...base, skipped: "no_calls" };

  const [run] = await db
    .insert(agentRuns)
    .values({ clientId: client.id, kind: "qa_review" })
    .returning();

  let gradedCount = 0;
  let flaggedCount = 0;
  try {
    for (const call of candidates) {
      const grade = await gradeCall(anthropic, client, {
        id: call.id,
        transcript: call.transcript ?? "",
        outcome: call.outcome,
      });
      if (!grade) continue;
      const needsReview = grade.score <= 2 || grade.complianceRisk || grade.flags.length > 0;
      await db
        .insert(callGrades)
        .values({
          callId: call.id,
          clientId: client.id,
          runId: run?.id,
          score: grade.score,
          flags: grade.flags,
          complianceRisk: grade.complianceRisk,
          coachingNote: grade.coachingNote.trim() || null,
          // Clean calls are auto-closed; only defects wait in the queue.
          status: needsReview ? "open" : "reviewed",
        })
        .onConflictDoNothing({ target: callGrades.callId });
      gradedCount += 1;
      if (needsReview) flaggedCount += 1;
    }

    if (run) {
      await db
        .update(agentRuns)
        .set({
          status: "succeeded",
          finishedAt: new Date(),
          stats: { graded: gradedCount, flagged: flaggedCount },
        })
        .where(eq(agentRuns.id, run.id));
    }
    return { ...base, graded: gradedCount, flagged: flaggedCount };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (run) {
      await db
        .update(agentRuns)
        .set({ status: "failed", finishedAt: new Date(), error: message })
        .where(eq(agentRuns.id, run.id));
    }
    logger.error("agents.qa.failed", { clientId: client.id, error: message });
    return { ...base, graded: gradedCount, flagged: flaggedCount, skipped: `error: ${message}` };
  }
}

/** Batch entry point: grade every live/trial client's recent calls. */
export async function runQaReview(sinceHours = 24): Promise<QaResult[]> {
  const active = await db.query.clients.findMany({
    where: and(inArray(clients.status, ["live", "trial"]), isNull(clients.deletedAt)),
  });
  const results: QaResult[] = [];
  for (const client of active) {
    results.push(await qaReviewClient(client, sinceHours));
  }
  return results;
}

/** Open review-queue count for an org (sidebar badge / dashboards). */
export async function countOpenGrades(orgId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(callGrades)
    .innerJoin(clients, eq(callGrades.clientId, clients.id))
    .where(and(eq(clients.orgId, orgId), eq(callGrades.status, "open")));
  return row?.n ?? 0;
}
