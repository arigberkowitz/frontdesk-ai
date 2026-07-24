import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { agentSuggestions, knowledgeItems, type Client } from "@/db/schema";
import { DRAFT_MODEL, getAnthropic, toolInput } from "./anthropic";
import { logger } from "@/lib/logger";

/**
 * Policy-doc ingestion. The owner pastes their price sheet / policies / FAQ
 * document; Claude extracts Q&A pairs grounded ONLY in that text; each pair
 * lands as a PROPOSED suggestion in the existing "Your AI learned" approval
 * queue. Nothing reaches the live phone agent until the owner approves it —
 * the same human gate every other knowledge path uses.
 */

const MAX_DOC_CHARS = 20_000;
const MAX_PAIRS = 15;

const EXTRACT_TOOL: Anthropic.Tool = {
  name: "save_extracted_faq",
  description:
    "Save Q&A pairs extracted from the business document. Every answer must come from the document text — never invent or embellish.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      pairs: {
        type: "array",
        maxItems: MAX_PAIRS,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            question: { type: "string", description: "A question a caller would actually ask." },
            answer: {
              type: "string",
              description:
                "The answer, using the document's own facts and numbers verbatim where possible.",
            },
          },
          required: ["question", "answer"],
        },
      },
    },
    required: ["pairs"],
  },
};

const extractSchema = z.object({
  pairs: z
    .array(z.object({ question: z.string().min(1), answer: z.string().min(1) }))
    .default([]),
});

export interface IngestResult {
  drafted: number;
  skippedDuplicates: number;
}

export async function ingestDocument(client: Client, docText: string): Promise<IngestResult> {
  const anthropic = getAnthropic();
  if (!anthropic) throw new Error("AI isn't configured.");

  const res = await anthropic.messages.create({
    model: DRAFT_MODEL,
    max_tokens: 4000,
    system:
      "You extract caller-facing Q&A pairs from a business's own document (price sheet, policies, FAQ) for its AI phone receptionist. Use ONLY facts stated in the document — exact prices, exact policy terms, exact hours. Skip anything vague, internal-only, or legally interpretive (contract clauses needing a lawyer's reading). Phrase questions the way a caller would ask them on the phone.",
    messages: [
      {
        role: "user",
        content: `Business: ${client.name}${client.industry ? ` (${client.industry})` : ""}\n\nDocument:\n${docText.slice(0, MAX_DOC_CHARS)}`,
      },
    ],
    tools: [EXTRACT_TOOL],
    tool_choice: { type: "tool", name: EXTRACT_TOOL.name },
  });

  const parsed = extractSchema.safeParse(toolInput(res));
  if (!parsed.success) {
    logger.warn("agents.ingest.invalid", { clientId: client.id });
    return { drafted: 0, skippedDuplicates: 0 };
  }

  // Dedupe against existing knowledge and pending suggestions.
  const [existing, pending] = await Promise.all([
    db.query.knowledgeItems.findMany({
      where: and(eq(knowledgeItems.clientId, client.id), isNull(knowledgeItems.deletedAt)),
      columns: { question: true },
    }),
    db.query.agentSuggestions.findMany({
      where: and(
        eq(agentSuggestions.clientId, client.id),
        eq(agentSuggestions.status, "proposed"),
      ),
      columns: { question: true },
    }),
  ]);
  const seen = new Set(
    [...existing.map((k) => k.question), ...pending.map((s) => s.question ?? "")]
      .filter(Boolean)
      .map((q) => q.trim().toLowerCase()),
  );

  const fresh = parsed.data.pairs.filter((p) => {
    const key = p.question.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (fresh.length > 0) {
    await db.insert(agentSuggestions).values(
      fresh.map((p) => ({
        clientId: client.id,
        type: "knowledge" as const,
        question: p.question.trim(),
        answer: p.answer.trim(),
        rationale: "Extracted from the document you uploaded — approve to teach it.",
      })),
    );
  }

  return { drafted: fresh.length, skippedDuplicates: parsed.data.pairs.length - fresh.length };
}
