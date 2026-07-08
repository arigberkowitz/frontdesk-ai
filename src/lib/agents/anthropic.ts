import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { env, integrations } from "@/lib/env";

/**
 * Shared Anthropic client for the agentic layer. Model split:
 *  - DRAFT_MODEL does the thinking (reads transcripts, proposes improvements).
 *  - CRITIC_MODEL is the cheap verify pass that keeps a bad suggestion from ever
 *    reaching a live phone line (groundedness / dedupe / safety gate).
 */
export const DRAFT_MODEL = "claude-opus-4-8";
export const CRITIC_MODEL = "claude-haiku-4-5";

export function getAnthropic(): Anthropic | null {
  if (!integrations.anthropic()) return null;
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}

/** First tool_use block of a response, or null. */
export function toolInput(res: Anthropic.Message): unknown | null {
  const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  return block ? block.input : null;
}
