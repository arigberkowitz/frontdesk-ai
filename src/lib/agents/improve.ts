import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { and, eq, gte, inArray, isNull, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  agentRuns,
  agentSuggestions,
  calls,
  callGrades,
  clients,
  knowledgeItems,
  type Client,
} from "@/db/schema";
import { CRITIC_MODEL, DRAFT_MODEL, getAnthropic, toolInput } from "./anthropic";
import { clientsAlreadyRun, mapLimit, outOfBudget } from "./util";
import { filterByFeature } from "@/lib/plan-access";
import { notifyOwnerLearnings } from "@/lib/notify";
import { logger } from "@/lib/logger";

/**
 * Agent #1 — the self-improving receptionist (observe → decide → act → observe).
 *
 * Nightly, per client: read the day's transcripts, find where the AI stumbled
 * (fell back to "someone will follow up", couldn't answer, frustrated caller,
 * missed booking), and DRAFT improvements — new knowledge Q/As and guidance
 * tweaks. A critic pass rejects anything not grounded in the transcripts.
 * Survivors land in `agent_suggestions` as *proposals*; nothing touches the live
 * agent until a human approves it in the portal ("Your AI learned 3 things").
 */

const MAX_CALLS_PER_RUN = 30;
const MAX_TRANSCRIPT_CHARS = 4000;
const MAX_OPEN_SUGGESTIONS = 9;

const DRAFT_TOOL: Anthropic.Tool = {
  name: "propose_improvements",
  description:
    "Propose improvements to the AI receptionist based ONLY on what actually happened in the transcripts. Propose nothing if the AI performed well.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      suggestions: {
        type: "array",
        maxItems: 5,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            type: {
              type: "string",
              enum: ["knowledge", "guidance"],
              description:
                "knowledge = a new Q/A the AI could not answer; guidance = a one-line behavioral instruction fixing a recurring mistake.",
            },
            question: { type: "string", description: "For knowledge: the caller's question, generalized." },
            answer: {
              type: "string",
              description:
                "For knowledge: the answer, ONLY if it is stated or clearly implied in a transcript or business context. Never invent prices, hours, or policies — if the business must supply the answer, write it as a bracketed placeholder like '[Owner: confirm price]'.",
            },
            guidance: { type: "string", description: "For guidance: one imperative sentence." },
            rationale: {
              type: "string",
              description: "One or two sentences, addressed to the business owner, on why this helps.",
            },
            callIds: { type: "array", items: { type: "string" }, description: "IDs of the calls that motivated this." },
            excerpt: { type: "string", description: "Short verbatim transcript excerpt (≤200 chars) showing the stumble." },
          },
          required: ["type", "rationale", "callIds"],
        },
      },
    },
    required: ["suggestions"],
  },
};

const draftSchema = z.object({
  suggestions: z
    .array(
      z.object({
        type: z.enum(["knowledge", "guidance"]),
        question: z.string().optional(),
        answer: z.string().optional(),
        guidance: z.string().optional(),
        rationale: z.string().min(1),
        callIds: z.array(z.string()).default([]),
        excerpt: z.string().optional(),
      }),
    )
    .default([]),
});

type DraftSuggestion = z.infer<typeof draftSchema>["suggestions"][number];

const CRITIC_TOOL: Anthropic.Tool = {
  name: "review_suggestions",
  description: "Return a keep/reject verdict for every drafted suggestion, by index.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      verdicts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            index: { type: "integer" },
            keep: { type: "boolean" },
            reason: { type: "string" },
          },
          required: ["index", "keep", "reason"],
        },
      },
    },
    required: ["verdicts"],
  },
};

const criticSchema = z.object({
  verdicts: z
    .array(z.object({ index: z.number().int(), keep: z.boolean(), reason: z.string() }))
    .default([]),
});

interface TranscriptCall {
  id: string;
  transcript: string;
  outcome: string | null;
  summary: string | null;
  flags?: string[];
}

function transcriptBlock(rows: TranscriptCall[]): string {
  return rows
    .map((c) => {
      const flags = c.flags?.length ? ` | QA flags: ${c.flags.join(", ")}` : "";
      return `<call id="${c.id}" outcome="${c.outcome ?? "unknown"}"${flags}>\n${c.transcript.slice(0, MAX_TRANSCRIPT_CHARS)}\n</call>`;
    })
    .join("\n\n");
}

/** Draft pass: read the day's transcripts, propose improvements. */
async function draftSuggestions(
  anthropic: Anthropic,
  client: Client,
  rows: TranscriptCall[],
  existingQuestions: string[],
): Promise<DraftSuggestion[]> {
  const res = await anthropic.messages.create({
    model: DRAFT_MODEL,
    max_tokens: 4000,
    system:
      "You are the improvement loop for an AI phone receptionist serving a local business. Read today's call transcripts and find where the receptionist stumbled: could not answer a question, fell back to 'someone will follow up', gave a vague or wrong answer, the caller sounded frustrated, or a bookable caller left unbooked. Propose the smallest set of high-confidence fixes as knowledge Q/As or one-line guidance tweaks. Ground every proposal in a specific transcript moment. NEVER invent prices, hours, services, or policies the business did not state — use a bracketed owner placeholder instead. Do not duplicate existing knowledge. If the receptionist did fine, propose nothing.",
    messages: [
      {
        role: "user",
        content: `Business: ${client.name}${client.industry ? ` (${client.industry})` : ""}
Current behavioral guidance: ${client.agentGuidance?.trim() || "(none)"}
Existing knowledge questions (do NOT duplicate):
${existingQuestions.length ? existingQuestions.map((q) => `- ${q}`).join("\n") : "(none)"}

Today's transcripts:
${transcriptBlock(rows)}`,
      },
    ],
    tools: [DRAFT_TOOL],
    tool_choice: { type: "tool", name: DRAFT_TOOL.name },
  });

  const parsed = draftSchema.safeParse(toolInput(res));
  if (!parsed.success) {
    logger.warn("agents.improve.draft_invalid", { clientId: client.id });
    return [];
  }
  // Structural validity: a knowledge item needs a question; guidance needs text.
  return parsed.data.suggestions.filter((s) =>
    s.type === "knowledge" ? Boolean(s.question?.trim()) : Boolean(s.guidance?.trim()),
  );
}

/**
 * Critic pass (the verify step): a drafted suggestion only survives if it is
 * grounded in the transcripts, non-duplicative, and safe to put near a live
 * phone line. Runs on the cheap model — it verifies, it doesn't create.
 */
async function criticFilter(
  anthropic: Anthropic,
  client: Client,
  rows: TranscriptCall[],
  existingQuestions: string[],
  drafts: DraftSuggestion[],
): Promise<{ kept: DraftSuggestion[]; rejected: number }> {
  if (drafts.length === 0) return { kept: [], rejected: 0 };

  const res = await anthropic.messages.create({
    model: CRITIC_MODEL,
    max_tokens: 1500,
    system:
      "You are a strict reviewer protecting a live business phone line. For each drafted suggestion, KEEP it only if: (1) the transcripts actually support it, (2) it does not invent prices/hours/services/policies (bracketed [Owner: ...] placeholders are acceptable), (3) it does not duplicate existing knowledge, (4) it is specific and actionable. Reject anything speculative, generic, or risky.",
    messages: [
      {
        role: "user",
        content: `Business: ${client.name}
Existing knowledge questions:
${existingQuestions.length ? existingQuestions.map((q) => `- ${q}`).join("\n") : "(none)"}

Transcripts:
${transcriptBlock(rows)}

Drafted suggestions (JSON, by index):
${JSON.stringify(drafts, null, 2)}`,
      },
    ],
    tools: [CRITIC_TOOL],
    tool_choice: { type: "tool", name: CRITIC_TOOL.name },
  });

  const parsed = criticSchema.safeParse(toolInput(res));
  if (!parsed.success) {
    // Fail closed: if the critic can't be parsed, ship nothing rather than everything.
    logger.warn("agents.improve.critic_invalid", { clientId: client.id });
    return { kept: [], rejected: drafts.length };
  }
  const keepSet = new Set(parsed.data.verdicts.filter((v) => v.keep).map((v) => v.index));
  const kept = drafts.filter((_, i) => keepSet.has(i));
  return { kept, rejected: drafts.length - kept.length };
}

export interface ImproveResult {
  clientId: string;
  clientName: string;
  callsReviewed: number;
  drafted: number;
  kept: number;
  skipped?: string;
}

/** Run the improvement loop for one client. */
export async function improveClient(client: Client, sinceHours = 24): Promise<ImproveResult> {
  const base: ImproveResult = {
    clientId: client.id,
    clientName: client.name,
    callsReviewed: 0,
    drafted: 0,
    kept: 0,
  };

  const anthropic = getAnthropic();
  if (!anthropic) return { ...base, skipped: "anthropic_unconfigured" };

  // Backpressure: don't pile proposals on an owner who hasn't reviewed the last batch.
  const [{ open }] = await db
    .select({ open: sql<number>`count(*)::int` })
    .from(agentSuggestions)
    .where(and(eq(agentSuggestions.clientId, client.id), eq(agentSuggestions.status, "proposed")));
  if (open >= MAX_OPEN_SUGGESTIONS) return { ...base, skipped: "review_backlog" };

  const since = new Date(Date.now() - sinceHours * 3600 * 1000);
  const rows = await db.query.calls.findMany({
    where: and(
      eq(calls.clientId, client.id),
      isNull(calls.deletedAt),
      isNotNull(calls.transcript),
      gte(calls.startAt, since),
    ),
    orderBy: (c, { desc }) => [desc(c.startAt)],
    limit: MAX_CALLS_PER_RUN,
  });
  const withTranscripts = rows.filter((r) => (r.transcript ?? "").trim().length > 0);
  if (withTranscripts.length === 0) return { ...base, skipped: "no_calls" };

  // Fold in open QA flags (agent #3's findings feed this loop).
  const grades = await db.query.callGrades.findMany({
    where: and(
      eq(callGrades.clientId, client.id),
      inArray(callGrades.callId, withTranscripts.map((r) => r.id)),
    ),
  });
  const flagsByCall = new Map(grades.map((g) => [g.callId, (g.flags as string[] | null) ?? []]));

  const transcriptCalls: TranscriptCall[] = withTranscripts.map((r) => ({
    id: r.id,
    transcript: r.transcript ?? "",
    outcome: r.outcome,
    summary: r.summary,
    flags: flagsByCall.get(r.id),
  }));

  const knowledge = await db.query.knowledgeItems.findMany({
    where: and(eq(knowledgeItems.clientId, client.id), isNull(knowledgeItems.deletedAt)),
    columns: { question: true },
  });
  const proposedOpen = await db.query.agentSuggestions.findMany({
    where: and(eq(agentSuggestions.clientId, client.id), eq(agentSuggestions.status, "proposed")),
    columns: { question: true },
  });
  const existingQuestions = [
    ...knowledge.map((k) => k.question),
    ...proposedOpen.map((s) => s.question ?? "").filter(Boolean),
  ];

  const [run] = await db
    .insert(agentRuns)
    .values({ clientId: client.id, kind: "nightly_improve" })
    .returning();

  try {
    const drafts = await draftSuggestions(anthropic, client, transcriptCalls, existingQuestions);
    const { kept, rejected } = await criticFilter(
      anthropic,
      client,
      transcriptCalls,
      existingQuestions,
      drafts,
    );

    // Belt-and-braces dedupe against existing questions (case-insensitive).
    const seen = new Set(existingQuestions.map((q) => q.trim().toLowerCase()));
    const fresh = kept.filter((s) => {
      if (s.type !== "knowledge") return true;
      const key = (s.question ?? "").trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (fresh.length > 0) {
      await db.insert(agentSuggestions).values(
        fresh.map((s) => ({
          clientId: client.id,
          runId: run?.id,
          type: s.type,
          question: s.question?.trim() || null,
          answer: s.answer?.trim() || null,
          guidance: s.guidance?.trim() || null,
          rationale: s.rationale.trim(),
          evidence: { callIds: s.callIds, excerpt: s.excerpt?.slice(0, 300) },
        })),
      );
      // Close the loop: tell the owner there's something to approve.
      await notifyOwnerLearnings(
        client,
        fresh.map((s) => (s.type === "knowledge" ? (s.question ?? "") : (s.guidance ?? ""))).filter(Boolean),
      ).catch((err) =>
        logger.warn("agents.improve.notify_failed", {
          clientId: client.id,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }

    const stats = {
      callsReviewed: transcriptCalls.length,
      drafted: drafts.length,
      criticRejected: rejected,
      kept: fresh.length,
    };
    if (run) {
      await db
        .update(agentRuns)
        .set({ status: "succeeded", finishedAt: new Date(), stats })
        .where(eq(agentRuns.id, run.id));
    }
    return { ...base, callsReviewed: transcriptCalls.length, drafted: drafts.length, kept: fresh.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (run) {
      await db
        .update(agentRuns)
        .set({ status: "failed", finishedAt: new Date(), error: message })
        .where(eq(agentRuns.id, run.id));
    }
    logger.error("agents.improve.failed", { clientId: client.id, error: message });
    return { ...base, skipped: `error: ${message}` };
  }
}

/** Nightly entry point: run the loop for every live/trial client.
 *  Concurrent (bounded), budget-aware, and resumable: clients already served
 *  in the last 20h are skipped, so truncated runs converge on retry. */
export async function runNightlyImprovement(
  sinceHours = 24,
  budgetMs = 240_000,
): Promise<ImproveResult[]> {
  const deadline = Date.now() + budgetMs;
  const candidates = await db.query.clients.findMany({
    where: and(inArray(clients.status, ["live", "trial"]), isNull(clients.deletedAt)),
  });
  // Nightly self-improvement is part of what Pro buys (trials/comps included).
  const active = await filterByFeature(candidates, "ai_improvement");
  const done = await clientsAlreadyRun(active.map((c) => c.id), "nightly_improve");
  return mapLimit(active, 3, async (client) => {
    const base: ImproveResult = {
      clientId: client.id,
      clientName: client.name,
      callsReviewed: 0,
      drafted: 0,
      kept: 0,
    };
    if (done.has(client.id)) return { ...base, skipped: "already_ran" };
    if (outOfBudget(deadline)) return { ...base, skipped: "time_budget" };
    return improveClient(client, sinceHours);
  });
}
