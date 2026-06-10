import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { env, integrations } from "./env";
import { logger } from "./logger";

/**
 * Structures scraped website text into a draft business profile (§8 step 3)
 * using Claude with a *forced tool call* — Claude must return JSON matching the
 * tool's input schema. We then validate defensively with zod.
 *
 * Model defaults to claude-opus-4-8 (Anthropic's recommended default). For this
 * high-volume, margin-sensitive extraction you can switch to the cheaper/faster
 * `claude-haiku-4-5` here — see DECISIONS.md.
 */
export const ONBOARDING_MODEL = "claude-opus-4-8";

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const PROFILE_TOOL: Anthropic.Tool = {
  name: "save_business_profile",
  description:
    "Save the structured profile extracted from the business's website. Use ONLY information present in the text; never invent prices, hours, or services.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string", description: "1–2 sentence summary of the business." },
      tone: { type: "string", description: "Brand tone in a few words, e.g. 'warm and professional'." },
      address: { type: "string", description: "Full street address if present, else empty string." },
      phone: { type: "string", description: "Main phone number if present, else empty string." },
      services: {
        type: "array",
        description: "Bookable services offered.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            durationMin: {
              type: "integer",
              description: "Typical duration in minutes if stated; otherwise 30.",
            },
            priceDollars: { type: "number", description: "Price in US dollars if stated; otherwise 0." },
            description: { type: "string" },
          },
          required: ["name", "durationMin", "priceDollars", "description"],
        },
      },
      hours: {
        type: "array",
        description: "Weekly business hours.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            day: { type: "string", enum: WEEKDAYS as unknown as string[] },
            open: { type: "string", description: "Opening time HH:MM (24h), empty if closed." },
            close: { type: "string", description: "Closing time HH:MM (24h), empty if closed." },
            closed: { type: "boolean" },
          },
          required: ["day", "open", "close", "closed"],
        },
      },
      faq: {
        type: "array",
        description: "Common questions and answers a caller might ask.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: { question: { type: "string" }, answer: { type: "string" } },
          required: ["question", "answer"],
        },
      },
    },
    required: ["summary", "tone", "address", "phone", "services", "hours", "faq"],
  },
};

const profileSchema = z.object({
  summary: z.string().default(""),
  tone: z.string().default(""),
  address: z.string().default(""),
  phone: z.string().default(""),
  services: z
    .array(
      z.object({
        name: z.string().min(1),
        durationMin: z.coerce.number().int().min(5).max(480).catch(30),
        priceDollars: z.coerce.number().min(0).catch(0),
        description: z.string().default(""),
      }),
    )
    .default([]),
  hours: z
    .array(
      z.object({
        day: z.string(),
        open: z.string().default(""),
        close: z.string().default(""),
        closed: z.coerce.boolean().default(false),
      }),
    )
    .default([]),
  faq: z
    .array(z.object({ question: z.string().min(1), answer: z.string().min(1) }))
    .default([]),
});

export type StructuredProfile = z.infer<typeof profileSchema>;

export function dayNameToIndex(day: string): number {
  const i = WEEKDAYS.findIndex((d) => d.toLowerCase() === day.trim().toLowerCase());
  return i >= 0 ? i : -1;
}

/**
 * Returns a structured profile, or null if Anthropic isn't configured or the
 * call/validation fails (the caller falls back to a bare draft for manual entry).
 */
export async function structureBusinessProfile(
  businessName: string,
  scrapedText: string,
): Promise<StructuredProfile | null> {
  if (!integrations.anthropic()) {
    logger.warn("onboarding.structure.skipped", { reason: "ANTHROPIC_API_KEY unset" });
    return null;
  }
  if (!scrapedText.trim()) return null;

  try {
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const res = await client.messages.create({
      model: ONBOARDING_MODEL,
      max_tokens: 8000,
      system:
        "You are an onboarding assistant for an AI phone receptionist. Extract a structured profile from the business's name and scraped website text. Use ONLY information present in the text — never invent prices, hours, services, or policies. Leave a field empty (\"\", 0, or []) when the information isn't present. Always call the save_business_profile tool.",
      messages: [
        {
          role: "user",
          content: `Business name: ${businessName}\n\nScraped website content:\n${scrapedText}`,
        },
      ],
      tools: [PROFILE_TOOL],
      tool_choice: { type: "tool", name: PROFILE_TOOL.name },
    });

    const toolUse = res.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (!toolUse) {
      logger.warn("onboarding.structure.no_tool_use");
      return null;
    }

    const parsed = profileSchema.safeParse(toolUse.input);
    if (!parsed.success) {
      logger.error("onboarding.structure.invalid", { issues: parsed.error.issues.length });
      return null;
    }
    return parsed.data;
  } catch (err) {
    logger.error("onboarding.structure.failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
