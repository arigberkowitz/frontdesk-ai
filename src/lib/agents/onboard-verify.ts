import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  PROFILE_TOOL,
  profileSchema,
  type StructuredProfile,
} from "@/lib/onboarding";
import { CRITIC_MODEL, DRAFT_MODEL, getAnthropic, toolInput } from "./anthropic";
import { logger } from "@/lib/logger";

/**
 * Agent #4 — autonomous onboarding, hardened. The extractor drafts a profile
 * from the crawled site; this module adds the agentic steps that make "one
 * paste → a fully set-up receptionist" trustworthy:
 *
 *  1. verifyProfile — an independent fact-check pass that re-reads the source
 *     text and strips or corrects anything the draft can't support (wrong
 *     prices, invented hours, embellished FAQ answers).
 *  2. draftVoiceIdentity — writes a greeting + behavioral guidance in the
 *     business's own tone, so the agent starts opinionated instead of generic.
 */

/** Cross-check a drafted profile against the source text; return the corrected
 *  profile, or the original draft if verification is unavailable. */
export async function verifyProfile(
  draft: StructuredProfile,
  scrapedText: string,
): Promise<{ profile: StructuredProfile; verified: boolean }> {
  const anthropic = getAnthropic();
  if (!anthropic || !scrapedText.trim()) return { profile: draft, verified: false };

  try {
    const res = await anthropic.messages.create({
      model: CRITIC_MODEL,
      max_tokens: 8000,
      system:
        "You are a fact-checker for an AI receptionist's business profile. You are given a DRAFT profile and the SOURCE website text it was extracted from. Return the corrected profile: keep facts the source supports; fix any price, duration, hour, address, or phone that contradicts the source; remove services, hours, or FAQ items the source does not support (better absent than wrong — a receptionist quoting a wrong price damages the business). Do not add anything new. Always call the save_business_profile tool.",
      messages: [
        {
          role: "user",
          content: `DRAFT profile (JSON):\n${JSON.stringify(draft)}\n\nSOURCE website text:\n${scrapedText.slice(0, 30000)}`,
        },
      ],
      tools: [PROFILE_TOOL],
      tool_choice: { type: "tool", name: PROFILE_TOOL.name },
    });

    const parsed = profileSchema.safeParse(toolInput(res));
    if (!parsed.success) {
      logger.warn("agents.onboard.verify_invalid");
      return { profile: draft, verified: false };
    }
    return { profile: parsed.data, verified: true };
  } catch (err) {
    logger.warn("agents.onboard.verify_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { profile: draft, verified: false };
  }
}

const VOICE_TOOL: Anthropic.Tool = {
  name: "save_voice_identity",
  description: "Save the receptionist's greeting and behavioral guidance for this business.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      greeting: {
        type: "string",
        description:
          "One short spoken greeting (≤160 chars) in the business's tone, naming the business. No emoji, no exclamation overload.",
      },
      guidance: {
        type: "string",
        description:
          "2–4 short imperative lines of behavioral guidance reflecting the business's tone and priorities (e.g. 'Lead with the free estimate.'). No prices or hours — those live in structured data.",
      },
    },
    required: ["greeting", "guidance"],
  },
};

const voiceSchema = z.object({
  greeting: z.string().default(""),
  guidance: z.string().default(""),
});

/** Draft a tone-matched greeting + guidance from the verified profile. */
export async function draftVoiceIdentity(
  businessName: string,
  agentName: string,
  profile: StructuredProfile,
): Promise<{ greeting: string; guidance: string } | null> {
  const anthropic = getAnthropic();
  if (!anthropic) return null;

  try {
    const res = await anthropic.messages.create({
      model: DRAFT_MODEL,
      max_tokens: 600,
      system:
        "You write the opening line and behavioral guidance for an AI phone receptionist. Match the business's brand tone. The greeting is spoken aloud on every call — short, warm, natural. Guidance shapes behavior across calls; keep it specific to this business, never generic filler.",
      messages: [
        {
          role: "user",
          content: `Business: ${businessName}
Receptionist name: ${agentName}
Summary: ${profile.summary || "(none)"}
Tone: ${profile.tone || "warm and professional"}
Services: ${profile.services.map((s) => s.name).join(", ") || "(none)"}`,
        },
      ],
      tools: [VOICE_TOOL],
      tool_choice: { type: "tool", name: VOICE_TOOL.name },
    });
    const parsed = voiceSchema.safeParse(toolInput(res));
    if (!parsed.success || !parsed.data.greeting.trim()) return null;
    return { greeting: parsed.data.greeting.trim(), guidance: parsed.data.guidance.trim() };
  } catch (err) {
    logger.warn("agents.onboard.voice_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
