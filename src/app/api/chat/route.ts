import type Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getClientForChat } from "@/lib/data/clients";
import { buildPromptForClient } from "@/lib/agent-publish";
import { DEFAULT_AGENT_NAME } from "@/lib/prompt";
import { agentToolUrl } from "@/lib/retell";
import { CHAT_SIGNATURE_HEADER, signChatToolRequest } from "@/lib/agent-tool-token";
import { CHAT_MODEL, getAnthropic } from "@/lib/agents/anthropic";
import { consumeAttempt } from "@/lib/rate-limit";
import { allowChatTurn } from "@/lib/data/chat-limits";
import { chatChannelPreamble, chatGreeting, nowLine } from "@/lib/chat/prompt";
import { chatTools } from "@/lib/chat/tools";
import { MAX_TOOL_ROUNDS, corsHeaders, sanitizeTurns, type ChatTurn } from "@/lib/chat/session";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The website chat receptionist.
 *
 * Same knowledge, same booking tools, same personality as the phone agent —
 * on the business's own website. The market said this was the second-biggest
 * thing competitors ship that we didn't, and every ingredient was already
 * here: the prompt builder, the tool endpoints, an Anthropic client. This
 * route is the loop that connects them.
 *
 * Public by necessity: it is called from other people's websites by visitors
 * with no account here. So it defends itself — the business must have turned
 * the widget on, the transcript is sanitized before the model sees it, tool
 * rounds are capped, and every IP is rate-limited. Tools are called over HTTP
 * against our own agent-tool endpoints with the client's own tool token plus a
 * per-client chat signature (x-frontdesk-chat-signature), so a chat booking is
 * checked, written, texted and webhooked exactly like a phone booking — and
 * the endpoints know for certain it came from web chat, not a phone call.
 * Nothing here is a second copy of booking logic.
 */

/**
 * Layered caps. The per-IP ones are in-memory (per warm instance) and only
 * slow a single scripted visitor; the per-business daily cap and the customer
 * text caps (src/lib/data/chat-limits.ts) live in Postgres and hold across
 * instances and IPs.
 */
const RATE_LIMIT_PER_10_MIN = 20;
const RATE_LIMIT_PER_IP_PER_CLIENT_PER_DAY = 80;
/** Tools that write something or notify someone: book, cancel, message, waitlist. */
const SIDE_EFFECT_TOOLS = new Set(["book", "cancel", "message", "waitlist"]);
const SIDE_EFFECTS_PER_IP_PER_HOUR = 6;
/** Businesses whose chat stays up. Paused (e.g. lapsed trial) and churned don't. */
const CHAT_STATUSES = new Set(["draft", "trial", "live"]);

function ip(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function OPTIONS(req: Request): Promise<Response> {
  return new Response(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

export async function POST(req: Request): Promise<Response> {
  const cors = corsHeaders(req.headers.get("origin"));
  const json = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { ...cors, "cache-control": "no-store" } });

  const limit = consumeAttempt(`chat:${ip(req)}`, RATE_LIMIT_PER_10_MIN, 10 * 60_000);
  if (!limit.ok) {
    return json({ error: "Too many messages — give it a minute." }, 429);
  }

  let body: { clientId?: unknown; messages?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: "Bad request" }, 400);
  }
  const clientId = typeof body.clientId === "string" ? body.clientId : "";
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) return json({ error: "Bad request" }, 400);

  const client = await getClientForChat(clientId);
  if (!client || !CHAT_STATUSES.has(client.status)) {
    return json({ error: "Chat isn't available for this business." }, 404);
  }
  const visitor = ip(req);

  const anthropic = getAnthropic();
  if (!anthropic) {
    logger.error("chat.no_model", { clientId });
    return json({ error: "Chat is temporarily unavailable." }, 503);
  }

  // A brand-new conversation asks for the opening line and nothing else.
  const turns = sanitizeTurns(body.messages);
  const agentName = client.agentName?.trim() || DEFAULT_AGENT_NAME;
  if (!turns) {
    return json({
      reply: chatGreeting({ businessName: client.name, agentName }),
      messages: [],
      // The widget titles itself from this so the embed needs nothing but an id.
      business: { name: client.name, agent: agentName },
    });
  }

  // Only turns that reach the model count — the opening line above is free.
  if (!consumeAttempt(`chat:${visitor}:${client.id}`, RATE_LIMIT_PER_IP_PER_CLIENT_PER_DAY, 24 * 3600_000).ok) {
    return json({ error: "Too many messages today — please call the business instead." }, 429);
  }
  if (!(await allowChatTurn(client.id))) {
    return json({ error: "Chat is busy right now — please call the business instead." }, 429);
  }

  const system =
    chatChannelPreamble({ businessName: client.name, agentName }) +
    nowLine(client.timezone) +
    "\n\n" +
    buildPromptForClient(client);

  const tools = chatTools({ waitlistEnabled: client.waitlistEnabled });
  const byName = new Map(tools.map((t) => [t.def.name, t]));

  const messages: Anthropic.MessageParam[] = turns.map((t) => ({ role: t.role, content: t.content }));
  let reply = "";

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const res = await anthropic.messages.create({
        model: CHAT_MODEL,
        max_tokens: 600,
        system,
        tools: tools.map((t) => t.def),
        messages,
      });

      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
      const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");

      if (uses.length === 0 || round === MAX_TOOL_ROUNDS) {
        reply = text || "Sorry — could you say that again?";
        break;
      }

      // Run each tool against the real endpoint, feed results back, go again.
      messages.push({ role: "assistant", content: res.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const use of uses) {
        const tool = byName.get(use.name);
        let output: string;
        if (!tool) {
          output = JSON.stringify({ error: "Unknown tool" });
        } else {
          output = await callTool(tool.path, client.id, use.input, visitor);
        }
        results.push({ type: "tool_result", tool_use_id: use.id, content: output });
      }
      messages.push({ role: "user", content: results });
    }
  } catch (err) {
    logger.error("chat.turn_failed", {
      clientId: client.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return json({ error: "Something went wrong on our end. Try again in a moment." }, 500);
  }

  logger.info("chat.turn", { clientId: client.id, turns: turns.length });
  const out: ChatTurn[] = [...turns, { role: "assistant", content: reply }];
  return json({ reply, messages: out });
}

/**
 * POST to one of our own agent-tool endpoints, exactly as Retell would.
 *
 * Returns the response body as text for the model. Never throws: a tool that
 * is down becomes a sentence the receptionist can work with, not a 500 the
 * visitor stares at.
 */
async function callTool(path: string, clientId: string, args: unknown, visitor: string): Promise<string> {
  if (
    SIDE_EFFECT_TOOLS.has(path) &&
    !consumeAttempt(`chat-actions:${visitor}:${clientId}`, SIDE_EFFECTS_PER_IP_PER_HOUR, 60 * 60_000).ok
  ) {
    logger.warn("chat.side_effect_limit", { clientId, path });
    return JSON.stringify({
      error:
        "Limit reached for this chat. Don't retry. Apologize and ask them to call the business directly.",
    });
  }
  try {
    const body = JSON.stringify({ args, call: { channel: "web_chat" } });
    const res = await fetch(agentToolUrl(env.APP_URL, path, clientId), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [CHAT_SIGNATURE_HEADER]: signChatToolRequest(clientId, body),
      },
      body,
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    if (!res.ok) {
      logger.warn("chat.tool_http_error", { path, status: res.status });
      return JSON.stringify({
        error: "That didn't go through. Apologize briefly and offer to take a message instead.",
      });
    }
    return text.slice(0, 8_000);
  } catch (err) {
    logger.warn("chat.tool_failed", { path, error: err instanceof Error ? err.message : String(err) });
    return JSON.stringify({
      error: "That didn't go through. Apologize briefly and offer to take a message instead.",
    });
  }
}
