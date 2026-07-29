import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import { listServices } from "@/lib/data/services";
import { listKnowledge } from "@/lib/data/knowledge";
import { listHours } from "@/lib/data/hours";
import { CRITIC_MODEL, getAnthropic, toolInput } from "./anthropic";
import { logger } from "@/lib/logger";

/**
 * Final setup readiness check. When the owner clicks "I'm done", this reviews
 * the whole configuration the way a picky front-desk manager would — services
 * without prices, a greeting that doesn't name the business, contradictory
 * hours, thin knowledge — and returns pass/fail with concrete fixes. Fail-soft:
 * if the AI is unavailable the check passes (the derived checklist already
 * guarantees the structural minimums).
 */

const CHECK_TOOL: Anthropic.Tool = {
  name: "report_readiness",
  description: "Report whether this AI receptionist setup is ready for live callers.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      ready: { type: "boolean" },
      issues: {
        type: "array",
        maxItems: 5,
        items: { type: "string" },
        description:
          "Only real problems a caller would notice, phrased as short fix-it instructions for the owner. Empty when ready.",
      },
    },
    required: ["ready", "issues"],
  },
};

const checkSchema = z.object({
  ready: z.boolean(),
  issues: z.array(z.string()).default([]),
});

export interface ReadinessResult {
  ready: boolean;
  issues: string[];
  checked: boolean;
}

export async function checkSetupReadiness(clientId: string): Promise<ReadinessResult> {
  const anthropic = getAnthropic();
  if (!anthropic) return { ready: true, issues: [], checked: false };

  const [client, services, knowledge, hours] = await Promise.all([
    getClientByIdUnsafe(clientId),
    listServices(clientId),
    listKnowledge(clientId),
    listHours(clientId).catch(() => null),
  ]);
  if (!client) return { ready: true, issues: [], checked: false };

  const summary = {
    business: client.name,
    industry: client.industry,
    greeting: client.greeting,
    agentName: client.agentName,
    services: services.map((s) => ({
      name: s.name,
      priceCents: s.priceCents,
      durationMin: s.durationMin,
    })),
    knowledgeCount: knowledge.length,
    knowledgeSample: knowledge.slice(0, 10).map((k) => k.question),
    hours: hours?.map((h) => ({
      day: h.dayOfWeek,
      closed: h.isClosed,
      open: h.openTime,
      close: h.closeTime,
    })),
  };

  try {
    const res = await anthropic.messages.create({
      model: CRITIC_MODEL,
      max_tokens: 1000,
      system:
        "You review an AI phone receptionist's configuration before it takes live calls. Flag ONLY problems a real caller would hit: a greeting that doesn't mention the business name, services with no price when callers will ask, obviously missing hours, near-empty knowledge for the industry, or contradictions. Do not invent nice-to-haves — if it's workable, pass it. Always call report_readiness.",
      messages: [
        { role: "user", content: `Setup to review (JSON):\n${JSON.stringify(summary)}` },
      ],
      tools: [CHECK_TOOL],
      tool_choice: { type: "tool", name: CHECK_TOOL.name },
    });
    const parsed = checkSchema.safeParse(toolInput(res));
    if (!parsed.success) return { ready: true, issues: [], checked: false };
    return { ready: parsed.data.ready, issues: parsed.data.issues.slice(0, 5), checked: true };
  } catch (err) {
    logger.warn("agents.setupcheck.failed", {
      clientId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ready: true, issues: [], checked: false };
  }
}
