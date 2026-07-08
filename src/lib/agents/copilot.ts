import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropic, DRAFT_MODEL } from "./anthropic";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import { getClientMetrics } from "@/lib/data/metrics";
import { listLeads } from "@/lib/data/leads";
import { listCalls } from "@/lib/data/calls";
import { listAppointments } from "@/lib/data/appointments";
import { createKnowledge } from "@/lib/data/knowledge";
import { syncAgentPrompt } from "@/lib/agent-publish";
import { formatCurrencyCents, formatDateTime } from "@/lib/format";
import { logger } from "@/lib/logger";

/**
 * Agent #6 — portal copilot. A user-initiated agent with tools over the
 * client's OWN data (tenancy enforced by construction: every tool closes over
 * the resolved clientId). Reads metrics/leads/calls/appointments; its only
 * write is adding a FAQ, which flows through the same publish path as the
 * portal's Knowledge tab.
 */

const MAX_TURNS = 6;

export interface CopilotMessage {
  role: "user" | "assistant";
  content: string;
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: "get_overview_metrics",
    description: "This business's headline metrics: calls, bookings, leads, revenue captured, after-hours saves.",
    input_schema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "list_recent_calls",
    description: "Recent calls with time, outcome, and summary (no full transcripts).",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 50, description: "Default 15." },
      },
    },
  },
  {
    name: "list_leads",
    description: "Captured leads (messages the AI took), newest first, with status and what they wanted.",
    input_schema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "list_appointments",
    description: "Appointments the AI booked, with customer, time, and status.",
    input_schema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "add_faq",
    description:
      "Add a question/answer to the AI receptionist's knowledge and republish it live. Use ONLY when the user explicitly asks to add/teach something, with the answer they provided.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        question: { type: "string" },
        answer: { type: "string" },
      },
      required: ["question", "answer"],
    },
  },
];

async function execTool(
  clientId: string,
  tz: string | null,
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  switch (name) {
    case "get_overview_metrics": {
      const m = await getClientMetrics(clientId);
      return JSON.stringify({
        callsAnswered: m.totalCalls,
        appointmentsBooked: m.bookings,
        leadsCaptured: m.leads,
        newLeadsAwaitingFollowUp: m.newLeads,
        afterHoursCalls: m.afterHoursCalls,
        estRevenueCaptured: formatCurrencyCents(m.estRevenueCents),
      });
    }
    case "list_recent_calls": {
      const limit = Math.min(50, Math.max(1, Number(input.limit) || 15));
      const rows = await listCalls(clientId, limit);
      return JSON.stringify(
        rows.map((c) => ({
          when: c.startAt ? formatDateTime(c.startAt, tz ?? undefined) : null,
          outcome: c.outcome,
          afterHours: c.isAfterHours,
          summary: c.summary?.slice(0, 300) ?? null,
        })),
      );
    }
    case "list_leads": {
      const rows = await listLeads(clientId);
      return JSON.stringify(
        rows.slice(0, 30).map((l) => ({
          name: l.name,
          phone: l.phone,
          wants: l.service ?? l.reason,
          message: l.message?.slice(0, 200),
          urgency: l.urgency,
          status: l.status,
        })),
      );
    }
    case "list_appointments": {
      const rows = await listAppointments(clientId);
      return JSON.stringify(
        rows.slice(0, 30).map((a) => ({
          customer: a.customerName,
          when: formatDateTime(a.startAt, tz ?? undefined),
          status: a.status,
        })),
      );
    }
    case "add_faq": {
      const question = String(input.question ?? "").trim();
      const answer = String(input.answer ?? "").trim();
      if (!question || !answer) return JSON.stringify({ ok: false, error: "question and answer required" });
      await createKnowledge(clientId, { question, answer, source: "manual", isActive: true });
      const client = await getClientByIdUnsafe(clientId);
      if (client) await syncAgentPrompt(client.orgId, clientId).catch(() => false);
      return JSON.stringify({ ok: true, added: question });
    }
    default:
      return JSON.stringify({ ok: false, error: `unknown tool ${name}` });
  }
}

/** Run one copilot exchange: prior messages + the new user turn → reply text. */
export async function runCopilot(
  clientId: string,
  history: CopilotMessage[],
): Promise<string> {
  const anthropic = getAnthropic();
  if (!anthropic) {
    return "The assistant isn't configured yet (missing AI key) — ask your account manager to enable it.";
  }

  const client = await getClientByIdUnsafe(clientId);
  const tz = client?.timezone ?? null;

  const messages: Anthropic.MessageParam[] = history
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content }));

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const res = await anthropic.messages.create({
        model: DRAFT_MODEL,
        max_tokens: 1200,
        system: `You are the portal assistant for ${client?.name ?? "this business"} inside FrontDesk AI. You answer questions about THEIR phone calls, leads, appointments, and metrics using the tools, and can add a FAQ to their AI receptionist when asked. Be concise and concrete — a busy owner is reading on their phone. Use plain sentences, not markdown headers. If asked for something outside your tools (billing, refunds, other businesses), say who to contact instead of guessing.`,
        messages,
        tools: TOOLS,
      });

      const toolUses = res.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );
      if (toolUses.length === 0 || res.stop_reason !== "tool_use") {
        const text = res.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
        return text || "Sorry — I came up empty. Try rephrasing?";
      }

      messages.push({ role: "assistant", content: res.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const out = await execTool(clientId, tz, tu.name, (tu.input ?? {}) as Record<string, unknown>);
        results.push({ type: "tool_result", tool_use_id: tu.id, content: out });
      }
      messages.push({ role: "user", content: results });
    }
    return "That took more steps than I'm allowed — try a narrower question.";
  } catch (err) {
    logger.error("agents.copilot.failed", {
      clientId,
      error: err instanceof Error ? err.message : String(err),
    });
    return "Something went wrong on my end — please try again.";
  }
}
