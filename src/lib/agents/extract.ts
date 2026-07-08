import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { appointments, calls, callInsights, leads } from "@/db/schema";
import { CRITIC_MODEL, getAnthropic, toolInput } from "./anthropic";
import { logger } from "@/lib/logger";

/**
 * Agent #2 — post-call extraction. Fires from the Retell webhook after
 * `call_analyzed`. Beyond the stock summary, it classifies intent, pulls
 * structured entities, detects spam, and drafts a follow-up text the owner can
 * send in one tap. Turns each call into an action.
 *
 * Runs on the cheap/fast model: this is high-volume, margin-sensitive work.
 */

const EXTRACT_TOOL: Anthropic.Tool = {
  name: "save_call_insights",
  description:
    "Save structured insights extracted from this call transcript. Use ONLY what is in the transcript.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      intent: {
        type: "string",
        enum: [
          "book_appointment",
          "question",
          "reschedule",
          "cancel",
          "complaint",
          "vendor_or_sales",
          "spam",
          "wrong_number",
          "other",
        ],
      },
      entities: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string", description: "Caller name if stated, else empty." },
          phone: { type: "string", description: "Callback number if stated, else empty." },
          service: { type: "string", description: "Service wanted, else empty." },
          requestedDate: { type: "string", description: "Requested date/time in the caller's words, else empty." },
          budget: { type: "string", description: "Budget if mentioned, else empty." },
        },
        required: ["name", "phone", "service", "requestedDate", "budget"],
      },
      isSpam: { type: "boolean", description: "True for robocalls, vendors, or telemarketing." },
      followUpDraft: {
        type: "string",
        description:
          "A short SMS (≤300 chars) from the business to this caller, ready to send, warm and specific to what they asked. Empty string if no follow-up makes sense (booked, spam, wrong number).",
      },
    },
    required: ["intent", "entities", "isSpam", "followUpDraft"],
  },
};

const insightSchema = z.object({
  intent: z.string().default("other"),
  entities: z
    .object({
      name: z.string().default(""),
      phone: z.string().default(""),
      service: z.string().default(""),
      requestedDate: z.string().default(""),
      budget: z.string().default(""),
    })
    .default({ name: "", phone: "", service: "", requestedDate: "", budget: "" }),
  isSpam: z.coerce.boolean().default(false),
  followUpDraft: z.string().default(""),
});

/** Extract insights for one stored call. Idempotent (unique on call_id). */
export async function extractCallInsights(callDbId: string): Promise<void> {
  const anthropic = getAnthropic();
  if (!anthropic) return;

  const call = await db.query.calls.findFirst({
    where: eq(calls.id, callDbId),
    with: { client: true },
  });
  if (!call || !call.transcript?.trim()) return;

  const existing = await db.query.callInsights.findFirst({
    where: eq(callInsights.callId, call.id),
  });
  if (existing) return;

  try {
    const res = await anthropic.messages.create({
      model: CRITIC_MODEL,
      max_tokens: 1000,
      system:
        "You extract structured insights from an AI receptionist's call transcript for a local business. Use ONLY what is in the transcript — never invent contact details, dates, or prices. The follow-up draft speaks as the business (first person plural), references what the caller actually wanted, and never promises prices or times the business didn't state.",
      messages: [
        {
          role: "user",
          content: `Business: ${call.client.name}${call.client.industry ? ` (${call.client.industry})` : ""}
Call outcome so far: ${call.outcome ?? "unknown"}

Transcript:
${call.transcript.slice(0, 8000)}`,
        },
      ],
      tools: [EXTRACT_TOOL],
      tool_choice: { type: "tool", name: EXTRACT_TOOL.name },
    });

    const parsed = insightSchema.safeParse(toolInput(res));
    if (!parsed.success) {
      logger.warn("agents.extract.invalid", { callId: call.id });
      return;
    }
    const data = parsed.data;

    await db
      .insert(callInsights)
      .values({
        callId: call.id,
        clientId: call.clientId,
        intent: data.intent,
        entities: data.entities,
        isSpam: data.isSpam,
        followUpChannel: data.followUpDraft ? "sms" : null,
        followUpDraft: data.followUpDraft || null,
      })
      .onConflictDoNothing({ target: callInsights.callId });

    // Spam reclassification — but never override a call that actually produced
    // an appointment or a lead.
    if (data.isSpam) {
      const [appt, lead] = await Promise.all([
        db.query.appointments.findFirst({ where: eq(appointments.callId, call.id) }),
        db.query.leads.findFirst({ where: eq(leads.callId, call.id) }),
      ]);
      if (!appt && !lead) {
        await db
          .update(calls)
          .set({ outcome: "spam" })
          .where(and(eq(calls.id, call.id), eq(calls.clientId, call.clientId)));
      }
    }
  } catch (err) {
    logger.error("agents.extract.failed", {
      callId: callDbId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
