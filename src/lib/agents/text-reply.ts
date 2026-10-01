import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { Client } from "@/db/schema";
import { CHAT_MODEL, getAnthropic } from "./anthropic";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { notifier } from "@/lib/notifier";
import { agentToolUrl } from "@/lib/retell";
import { SMS_SIGNATURE_HEADER, signSmsToolRequest } from "@/lib/agent-tool-token";
import { getClient } from "@/lib/data/clients";
import { getBookingProviderForClient } from "@/lib/booking";
import { isOptedOut } from "@/lib/data/sms-optouts";
import { customerKeyFor, getThread } from "@/lib/data/sms-messages";
import {
  claimThreadForAi,
  countAiSentToday,
  getThreadState,
  lastOwnerReplyAt,
  latestInboundId,
  releaseThreadForAi,
  setThreadAiPaused,
} from "@/lib/data/sms-threads";
import { notifyOwnerTextReply } from "@/lib/reply-alerts";
import { withinTextingHours } from "@/lib/appointment-messages";
import { nowLine } from "@/lib/chat/prompt";
import { DEFAULT_AGENT_NAME } from "@/lib/prompt";
import {
  AI_HANDOFF_KIND,
  AI_REPLY_KIND,
  MAX_TOOL_ROUNDS,
  aiReplyEligibility,
  buildSmsSystemPrompt,
  buildTranscriptTurn,
  forcedHandoff,
  guardReply,
  handoffReasonLabel,
  handoffText,
  namedReply,
  type HandoffCategory,
  type SkipReason,
} from "@/lib/sms-ai/rules";
import { HANDOFF, SEND_REPLY, smsTools } from "@/lib/sms-ai/tools";

/**
 * Agent — AI text replies. A customer texted a business that turned this on;
 * draft and send a reply grounded only in that business's services, hours and
 * FAQ, and book / reschedule / cancel through the same agent-tool endpoints
 * the phone agent uses.
 *
 * Guardrails (see src/lib/sms-ai/rules.ts for the pure versions):
 *  - OFF by default per business (Settings → Follow-ups). Trial/live only.
 *  - Only ever a reply: it runs on an inbound text, so the customer texted
 *    first (the consent the published policy grants for a reply). STOP
 *    (shared or this business) is checked before the model and again before
 *    sending; isOptedOut fails safe.
 *  - Customer texting hours (9:00–20:00 local). Outside them the owner gets the
 *    normal reply alert and nobody is texted.
 *  - Durable caps from sms_messages: per thread and per business per day. A
 *    thread that hits its cap is handed to the owner.
 *  - Emergencies, "get me a person", and sensitive topics are detected on the
 *    raw text BEFORE the model and handed off — injection can't talk past it.
 *  - Customer text is fenced data; the reply is checked before it leaves (no
 *    links, phone numbers, prompt talk, codes; length cap). A failed check
 *    hands off instead of sending.
 *  - The owner is in charge: a manual portal reply pauses the AI in that
 *    thread for N hours; "Pause AI" pauses it until resumed; a handoff pauses
 *    it and emails the reply alert. Nothing here edits the live agent.
 */

export type TextReplyOutcome =
  | { status: "skipped"; reason: SkipReason | "busy" | "no_model" | "no_client" | "nothing_to_answer" }
  | { status: "replied"; text: string }
  | { status: "handed_off"; category: HandoffCategory }
  | { status: "failed"; error: string };

export interface AiPlan {
  ok: boolean;
  reason?: SkipReason;
}

/**
 * Should the AI take this inbound text? Cheap, and called in the webhook before
 * the owner alert is decided. Throws on DB error (callers treat that as "no",
 * which falls back to today's behavior: the owner gets the alert).
 */
export async function planAiReply(client: Client, customerPhone: string, now = new Date()): Promise<AiPlan> {
  if (!client.aiTextRepliesEnabled) return { ok: false, reason: "off" };
  const [optedOut, thread, ownerAt, sent] = await Promise.all([
    isOptedOut(customerPhone, client.id),
    getThreadState(client.id, customerPhone),
    lastOwnerReplyAt(client.id, customerPhone),
    countAiSentToday(client.id, customerPhone),
  ]);
  const verdict = aiReplyEligibility({
    enabled: client.aiTextRepliesEnabled,
    clientStatus: client.status,
    optedOut,
    threadPaused: Boolean(thread?.aiPaused),
    lastOwnerReplyAt: ownerAt,
    resumedAt: thread?.aiResumedAt ?? null,
    pauseHours: client.aiTextPauseHours,
    withinTextingHours: withinTextingHours(now, client.timezone),
    aiSentToday: sent,
    now,
  });
  return verdict.ok ? { ok: true } : { ok: false, reason: verdict.reason };
}

/** Stop the AI in this thread, tell the customer (templated) and email the owner. */
export async function handOff(
  client: Client,
  customerPhone: string,
  category: HandoffCategory,
  lastCustomerText: string,
  opts: { sendHoldingText: boolean; note?: string },
): Promise<void> {
  const key = customerKeyFor(customerPhone);
  if (!key) return;
  await setThreadAiPaused(client.id, key, true, `handoff:${category}`);
  if (opts.sendHoldingText && !(await isOptedOut(key, client.id))) {
    await notifier.sendSms({
      to: `+${key}`,
      body: handoffText(client.name, category),
      log: { clientId: client.id, kind: AI_HANDOFF_KIND },
    });
  }
  try {
    await notifyOwnerTextReply(client, {
      customerPhone: key,
      body: lastCustomerText,
      aiHandoff: `${handoffReasonLabel(category)}${opts.note ? ` — ${opts.note.replace(/\s+/g, " ").slice(0, 160)}` : ""}`,
    });
  } catch (err) {
    logger.error("sms_ai.handoff_alert_failed", {
      clientId: client.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  logger.info("sms_ai.handed_off", { clientId: client.id, category });
}

/** POST one agent-tool endpoint as the SMS channel. Never throws. */
async function callTool(path: string, clientId: string, customerKey: string, args: unknown): Promise<string> {
  try {
    const body = JSON.stringify({ args, call: { channel: "sms", from_number: `+${customerKey}` } });
    const res = await fetch(agentToolUrl(env.APP_URL, path, clientId), {
      method: "POST",
      headers: { "content-type": "application/json", [SMS_SIGNATURE_HEADER]: signSmsToolRequest(clientId, body) },
      body,
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    if (!res.ok) {
      logger.warn("sms_ai.tool_http_error", { path, status: res.status });
      return JSON.stringify({ error: "That didn't go through. Hand the conversation to the owner." });
    }
    return text.slice(0, 6_000);
  } catch (err) {
    logger.warn("sms_ai.tool_failed", { path, error: err instanceof Error ? err.message : String(err) });
    return JSON.stringify({ error: "That didn't go through. Hand the conversation to the owner." });
  }
}

type Decision =
  | { kind: "reply"; text: string }
  | { kind: "handoff"; category: HandoffCategory; note?: string };

/** The model loop: tools in, one final decision out. */
async function decide(
  anthropic: Anthropic,
  system: string,
  transcript: string,
  clientId: string,
  customerKey: string,
  bookingEnabled: boolean,
): Promise<Decision> {
  const tools = smsTools({ bookingEnabled });
  const byName = new Map(tools.map((t) => [t.def.name, t]));
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: transcript }];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const res = await anthropic.messages.create({
      model: CHAT_MODEL,
      max_tokens: 500,
      system,
      tools: tools.map((t) => t.def),
      messages,
    });
    const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const final = uses.find((u) => u.name === SEND_REPLY || u.name === HANDOFF);
    if (final) {
      const input = (final.input ?? {}) as Record<string, unknown>;
      if (final.name === HANDOFF) {
        const c = String(input.category ?? "unsure");
        const category = (["human_requested", "emergency", "sensitive", "unsure"].includes(c) ? c : "unsure") as HandoffCategory;
        return { kind: "handoff", category, note: typeof input.note === "string" ? input.note : undefined };
      }
      return { kind: "reply", text: String(input.text ?? "") };
    }
    if (uses.length === 0) {
      // Plain text without a decision tool: treat as a reply draft; the guard
      // still decides whether it may be sent.
      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join(" ")
        .trim();
      return text ? { kind: "reply", text } : { kind: "handoff", category: "unsure" };
    }
    messages.push({ role: "assistant", content: res.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of uses) {
      const tool = byName.get(use.name);
      const out = tool?.path
        ? await callTool(tool.path, clientId, customerKey, use.input)
        : JSON.stringify({ error: "Unknown tool" });
      results.push({ type: "tool_result", tool_use_id: use.id, content: out });
    }
    messages.push({ role: "user", content: results });
  }
  return { kind: "handoff", category: "unsure", note: "took too many steps" };
}

/**
 * Answer the newest customer text in one thread. Runs after the Twilio webhook
 * has responded (next/server `after`). Never throws.
 */
export async function runAiTextReply(client: Client, customerPhone: string): Promise<TextReplyOutcome> {
  const key = customerKeyFor(customerPhone);
  if (!key) return { status: "skipped", reason: "nothing_to_answer" };
  const anthropic = getAnthropic();
  if (!anthropic) return { status: "skipped", reason: "no_model" };

  let claimed = false;
  try {
    claimed = await claimThreadForAi(client.id, key);
    // Another run is answering this thread; it re-checks for newer texts
    // before it lets go, so this one isn't lost.
    if (!claimed) return { status: "skipped", reason: "busy" };

    let outcome: TextReplyOutcome = { status: "skipped", reason: "nothing_to_answer" };
    for (let pass = 0; pass < 2; pass++) {
      const plan = await planAiReply(client, key);
      if (!plan.ok) {
        if (plan.reason === "thread_cap" || plan.reason === "client_cap") {
          const history = await getThread(client.id, key, 1);
          await handOff(client, key, "limit", history.at(-1)?.body ?? "", { sendHoldingText: false });
          return { status: "handed_off", category: "limit" };
        }
        return pass === 0 ? { status: "skipped", reason: plan.reason! } : outcome;
      }

      const history = await getThread(client.id, key, 40);
      const lastInbound = [...history].reverse().find((m) => m.direction === "inbound");
      const lastMessage = history.at(-1);
      // Nothing new to answer (we already replied after their last text).
      if (!lastInbound || !lastMessage || lastMessage.direction !== "inbound") return outcome;

      const forced = forcedHandoff(lastInbound.body);
      if (forced) {
        await handOff(client, key, forced, lastInbound.body, { sendHoldingText: true });
        return { status: "handed_off", category: forced };
      }

      const full = await getClient(client.orgId, client.id);
      if (!full) return { status: "skipped", reason: "no_client" };
      const bookingEnabled = getBookingProviderForClient(full).isConfigured();
      const system = buildSmsSystemPrompt(
        {
          name: full.name,
          agentName: full.agentName?.trim() || DEFAULT_AGENT_NAME,
          industry: full.industry,
          address: full.address,
          timezone: full.timezone,
          guidance: full.agentGuidance,
          bookingInstructions: full.bookingInstructions,
          bookingEnabled,
          services: full.services,
          hours: full.businessHours,
          knowledge: full.knowledgeItems,
        },
        nowLine(full.timezone),
      );
      const transcript = buildTranscriptTurn(
        history.map((m) => ({ direction: m.direction, body: m.body, kind: m.kind })),
      );

      const decision = await decide(anthropic, system, transcript, client.id, key, bookingEnabled);
      if (decision.kind === "handoff") {
        await handOff(client, key, decision.category, lastInbound.body, {
          sendHoldingText: true,
          note: decision.note,
        });
        return { status: "handed_off", category: decision.category };
      }

      const checked = guardReply(decision.text);
      if (!checked.ok) {
        logger.warn("sms_ai.reply_blocked", { clientId: client.id, why: checked.why });
        await handOff(client, key, "unsafe_output", lastInbound.body, { sendHoldingText: true });
        return { status: "handed_off", category: "unsafe_output" };
      }

      // The owner may have paused or replied while the model was thinking, or
      // the customer may have texted STOP. Re-check right before sending.
      const recheck = await planAiReply(client, key);
      if (!recheck.ok) return { status: "skipped", reason: recheck.reason! };

      const body = namedReply(checked.text, client.name);
      const sent = await notifier.sendSms({
        to: `+${key}`,
        body,
        log: { clientId: client.id, kind: AI_REPLY_KIND },
      });
      if (sent.skipped) return { status: "failed", error: "sms_not_configured" };
      outcome = sent.ok ? { status: "replied", text: body } : { status: "failed", error: sent.error ?? "send failed" };
      if (!sent.ok) return outcome;

      // A newer text arrived while we worked: answer it too (once).
      const newest = await latestInboundId(client.id, key);
      if (!newest || newest === lastInbound.id) break;
    }
    return outcome;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("sms_ai.failed", { clientId: client.id, error: message });
    // Fall back to how things worked before this feature: the owner hears about it.
    try {
      const last = (await getThread(client.id, key, 1)).at(-1);
      await notifyOwnerTextReply(client, { customerPhone: key, body: last?.body ?? "" });
    } catch {
      // nothing more we can do
    }
    return { status: "failed", error: message };
  } finally {
    if (claimed) await releaseThreadForAi(client.id, key);
  }
}
