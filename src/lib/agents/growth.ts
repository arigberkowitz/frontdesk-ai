import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { scrapeWebsite, normalizeUrl } from "@/lib/scrape";
import { DRAFT_MODEL, getAnthropic, toolInput } from "./anthropic";
import { logger } from "@/lib/logger";

/**
 * Agent #7 — agency growth (for the operator, not their clients). Paste
 * prospect websites; the agent reads each one, scores how badly they need an
 * AI receptionist (phone-first, no online booking, service business), and
 * drafts personalized outreach. Lead-gen for the agency itself.
 */

const MAX_PROSPECTS = 5;

const PROSPECT_TOOL: Anthropic.Tool = {
  name: "save_prospect_report",
  description: "Save the fit assessment and outreach draft for this prospect.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      businessName: { type: "string" },
      businessType: { type: "string", description: "e.g. plumber, dental office, salon." },
      fitScore: {
        type: "integer",
        minimum: 1,
        maximum: 5,
        description:
          "5 = ideal (phone-first service business, no online booking, likely misses calls); 1 = poor fit (e-commerce, enterprise, already automated).",
      },
      signals: {
        type: "array",
        items: { type: "string" },
        description: "Short observed signals, e.g. 'phone number in header, no booking widget'.",
      },
      outreachSubject: { type: "string", description: "Email subject, ≤60 chars, no clickbait." },
      outreachBody: {
        type: "string",
        description:
          "3–6 sentence cold email referencing something specific from THEIR site. Plain, human, no hype words. Sign-off placeholder [Your name].",
      },
    },
    required: ["businessName", "businessType", "fitScore", "signals", "outreachSubject", "outreachBody"],
  },
};

const prospectSchema = z.object({
  businessName: z.string().default(""),
  businessType: z.string().default(""),
  fitScore: z.coerce.number().int().min(1).max(5).catch(3),
  signals: z.array(z.string()).default([]),
  outreachSubject: z.string().default(""),
  outreachBody: z.string().default(""),
});

export interface ProspectReport {
  url: string;
  ok: boolean;
  error?: string;
  businessName?: string;
  businessType?: string;
  fitScore?: number;
  signals?: string[];
  outreachSubject?: string;
  outreachBody?: string;
}

async function assessProspect(anthropic: Anthropic, url: string): Promise<ProspectReport> {
  try {
    const scraped = await scrapeWebsite(url);
    if (!scraped.combinedText.trim()) {
      return { url, ok: false, error: "Couldn't read the site (blocked or empty)." };
    }
    const res = await anthropic.messages.create({
      model: DRAFT_MODEL,
      max_tokens: 1200,
      system:
        "You prospect local service businesses for an agency selling an AI phone receptionist (answers 24/7, books appointments, bilingual, captures leads). From the website text, judge fit and draft outreach. Look for: phone-first contact flow, no online booking, appointment-based services, small team, after-hours exposure. The email must reference something genuinely specific from their site — a service, a claim, their hours — and offer one concrete value line. No 'I hope this finds you well', no exclamation marks, no 'seamless/unlock/leverage'.",
      messages: [
        {
          role: "user",
          content: `Prospect website (${url}):\n${scraped.combinedText.slice(0, 20000)}`,
        },
      ],
      tools: [PROSPECT_TOOL],
      tool_choice: { type: "tool", name: PROSPECT_TOOL.name },
    });
    const parsed = prospectSchema.safeParse(toolInput(res));
    if (!parsed.success) return { url, ok: false, error: "Assessment failed to parse." };
    return { url, ok: true, ...parsed.data };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("agents.growth.prospect_failed", { url, error: message });
    return { url, ok: false, error: message };
  }
}

/** Assess up to five prospect URLs. */
export async function prospectWebsites(rawUrls: string[]): Promise<ProspectReport[]> {
  const anthropic = getAnthropic();
  const urls = [...new Set(rawUrls.map(normalizeUrl))].slice(0, MAX_PROSPECTS);
  if (!anthropic) {
    return urls.map((url) => ({ url, ok: false, error: "Anthropic key not configured." }));
  }
  const out: ProspectReport[] = [];
  for (const url of urls) {
    out.push(await assessProspect(anthropic, url));
  }
  return out.sort((a, b) => (b.fitScore ?? 0) - (a.fitScore ?? 0));
}
