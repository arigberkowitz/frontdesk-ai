import type Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getClientForChatByKey } from "@/lib/data/clients";
import { buildPromptForClient } from "@/lib/agent-publish";
import { DEFAULT_AGENT_NAME } from "@/lib/prompt";
import { agentToolUrl } from "@/lib/retell";
import { CHAT_SIGNATURE_HEADER, agentToolHeaders, signChatToolRequest } from "@/lib/agent-tool-token";
import { CHAT_MODEL, getAnthropic } from "@/lib/agents/anthropic";
import { consumeAttempt } from "@/lib/rate-limit";
import { WAF_RATE_LIMIT_IDS, wafRateLimited } from "@/lib/waf-rate-limit";
import { recordChatTurnOutcome, startChatTurn } from "@/lib/data/chat-limits";
import { planAccessFor } from "@/lib/plan-access";
import { chatChannelPreamble, chatGreeting, nowLine } from "@/lib/chat/prompt";
import { chatTools } from "@/lib/chat/tools";
import {
  isWidgetKey,
  originAllowed,
  safeConversationId,
  widgetLang,
  widgetSettings,
} from "@/lib/chat/widget-access";
import {
  MAX_TOOL_ROUNDS,
  confirmedBy,
  sameOriginHeaders,
  sanitizeTurns,
  submittedCode,
  successClaim,
  toolForClaim,
  unconfirmedReply,
  type ChatTurn,
  type ClaimKind,
} from "@/lib/chat/session";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The website chat receptionist (Pro plan).
 *
 * Same knowledge, same booking tools, same guardrails as the phone agent, on
 * the business's own website. The prompt builder, the tool endpoints and the
 * Anthropic client already existed; this route is the loop that connects them.
 *
 * Who can reach it (src/lib/chat/widget-access.ts):
 *  - Only our own widget frame (/widget/frame, served from this origin and
 *    embedded in an iframe on the business's site). The request must carry our
 *    own Origin; there are no CORS grants, so a script on someone else's page
 *    can't call this directly.
 *  - The business is found by its public widget key, must have the chat turned
 *    on, be active, and be on a plan that includes website_chat.
 *  - The page embedding the frame must be on the owner's allowed-domains list
 *    (the frame's CSP frame-ancestors enforces that in the browser; this
 *    re-checks the origin the frame reports).
 *
 * Then it defends its spend: the transcript is sanitized and length-capped
 * before the model sees it, tool rounds are capped, every IP is rate-limited,
 * and each business has a durable daily turn cap. Tools are called over HTTP
 * against our own agent-tool endpoints with the client's own tool token plus a
 * per-client chat signature (x-frontdesk-chat-signature), so a chat booking is
 * checked, written, texted and webhooked exactly like a phone booking, and a
 * chat lead lands in the same Leads list with the same owner alert. Nothing
 * here is a second copy of booking logic.
 */

/**
 * Layered caps. The per-IP ones are in-memory (per warm instance) and only
 * slow a single scripted visitor; the per-business daily cap and the customer
 * text caps (src/lib/data/chat-limits.ts) live in Postgres and hold across
 * instances and IPs.
 */
const RATE_LIMIT_PER_10_MIN = 20;
const RATE_LIMIT_PER_IP_PER_CLIENT_PER_DAY = 80;
/** Largest request body we'll parse. 30 turns × 2,000 chars fits with room. */
const MAX_BODY_BYTES = 80_000;
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

function appOrigin(): string {
  try {
    return new URL(env.APP_URL).origin;
  } catch {
    return "";
  }
}

/** No CORS grant: only our own frame (same origin) may call this. */
export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: sameOriginHeaders() });
}

export async function POST(req: Request): Promise<Response> {
  const json = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: sameOriginHeaders() });

  if (await wafRateLimited(WAF_RATE_LIMIT_IDS.chat, { request: req })) {
    return json({ error: "Too many messages — give it a minute." }, 429);
  }
  const limit = consumeAttempt(`chat:${ip(req)}`, RATE_LIMIT_PER_10_MIN, 10 * 60_000);
  if (!limit.ok) {
    return json({ error: "Too many messages — give it a minute." }, 429);
  }

  // Our frame only. A browser always sends Origin on a cross-origin POST and
  // on a same-origin fetch POST, so a third-party page can't pass as us.
  const self = appOrigin();
  if (!self || req.headers.get("origin") !== self) {
    return json({ error: "Chat isn't available here." }, 403);
  }

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return json({ error: "That message is too long." }, 413);
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return json({ error: "Chat isn't available right now." }, 400);
  }
  if (raw.length > MAX_BODY_BYTES) return json({ error: "That message is too long." }, 413);
  let body: { key?: unknown; messages?: unknown; parent?: unknown; lang?: unknown; conversationId?: unknown };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return json({ error: "Chat isn't available right now." }, 400);
  }
  if (!body || typeof body !== "object" || !isWidgetKey(body.key)) {
    return json({ error: "Chat isn't available right now." }, 400);
  }

  const client = await getClientForChatByKey(body.key);
  if (!client || !CHAT_STATUSES.has(client.status)) {
    return json({ error: "Chat isn't available for this business." }, 404);
  }
  const settings = widgetSettings(client.setupFlags);
  const parent = typeof body.parent === "string" ? body.parent.slice(0, 300) : null;
  if (!originAllowed(parent, settings.domains, self)) {
    logger.warn("chat.origin_refused", { clientId: client.id, parent });
    return json({ error: "Chat isn't set up for this website yet." }, 403);
  }
  // Pro only, checked on every request: a downgrade turns the chat off at once.
  const access = await planAccessFor(client);
  if (!access.has("website_chat")) {
    return json({ error: "Chat isn't available for this business.", code: "plan" }, 403);
  }

  const visitor = ip(req);
  const lang = widgetLang(body.lang);
  const conversationId = safeConversationId(body.conversationId);

  const anthropic = getAnthropic();
  if (!anthropic) {
    logger.error("chat.no_model", { clientId: client.id });
    return json({ error: "Chat is temporarily unavailable." }, 503);
  }

  // A brand-new conversation asks for the opening line and nothing else.
  const turns = sanitizeTurns(body.messages);
  const agentName = client.agentName?.trim() || DEFAULT_AGENT_NAME;
  if (!turns) {
    return json({
      reply: chatGreeting({ businessName: client.name, agentName, lang }),
      messages: [],
      business: { name: client.name, agent: agentName },
    });
  }

  // Only turns that reach the model count — the opening line above is free.
  if (!consumeAttempt(`chat:${visitor}:${client.id}`, RATE_LIMIT_PER_IP_PER_CLIENT_PER_DAY, 24 * 3600_000).ok) {
    return json({ error: "Too many messages today — please call the business instead." }, 429);
  }
  const turn = await startChatTurn(client.id, conversationId);
  if (!turn.ok) {
    return json({ error: "Chat is busy right now — please call the business instead." }, 429);
  }

  const system =
    chatChannelPreamble({ businessName: client.name, agentName, lang }) +
    nowLine(client.timezone) +
    "\n\n" +
    buildPromptForClient(client);

  const tools = chatTools({ waitlistEnabled: client.waitlistEnabled });
  const byName = new Map(tools.map((t) => [t.def.name, t]));

  const messages: Anthropic.MessageParam[] = turns.map((t) => ({ role: t.role, content: t.content }));
  let reply = "";
  // Success claims ("booked", "cancelled", "sent"…) are only allowed when a
  // tool result in THIS turn backs them. Otherwise force the tool once; if it
  // still isn't backed, say honestly that it didn't work.
  const confirmed = new Set<ClaimKind>();
  const attempted = new Set<string>();
  let retried = false;
  const outcome = { leads: 0, bookings: 0 };
  // A typed cancel code always reaches cancel_appointment (prod Oct 14: Riley
  // said "cancelled" on the code turn without calling anything).
  const codeTurn = submittedCode(turns) !== null && byName.has("cancel_appointment");
  const create = (toolChoice?: string) =>
    anthropic.messages.create({
      model: CHAT_MODEL,
      max_tokens: 600,
      system,
      tools: tools.map((t) => t.def),
      ...(toolChoice ? { tool_choice: { type: "tool" as const, name: toolChoice } } : {}),
      messages,
    });
  const textOf = (res: Anthropic.Message) =>
    res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const forceCode = round === 0 && codeTurn;
      if (forceCode) {
        retried = true;
        logger.info("chat.code_forced_cancel", { clientId: client.id });
      }
      let res = await create(forceCode ? "cancel_appointment" : undefined);

      if (!res.content.some((b) => b.type === "tool_use")) {
        const claim = successClaim(textOf(res));
        if (claim && !confirmed.has(claim)) {
          const forced = toolForClaim(claim, textOf(res));
          if (!retried && byName.has(forced) && !attempted.has(forced)) {
            retried = true;
            logger.warn("chat.claim_without_tool", { clientId: client.id, claim, forced });
            res = await create(forced);
          }
        }
      }

      const text = textOf(res);
      const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");

      if (uses.length === 0 || round === MAX_TOOL_ROUNDS) {
        reply = text || "Sorry — could you say that again?";
        const claim = successClaim(reply);
        if (claim && !confirmed.has(claim)) {
          logger.warn("chat.unbacked_claim", { clientId: client.id, claim });
          reply = unconfirmedReply(claim);
        }
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
          attempted.add(use.name);
          output = await callTool(tool.path, client.id, use.input, visitor);
          for (const k of confirmedBy(use.name, output)) confirmed.add(k);
          if (toolSucceeded(output)) {
            if (use.name === "take_message") outcome.leads += 1;
            if (use.name === "book_appointment") outcome.bookings += 1;
          }
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

  logger.info("chat.turn", { clientId: client.id, turns: turns.length, ...outcome });
  await recordChatTurnOutcome(client.id, turn.runId, outcome);
  const out: ChatTurn[] = [...turns, { role: "assistant", content: reply }];
  return json({ reply, messages: out, events: { lead: outcome.leads > 0, booking: outcome.bookings > 0 } });
}

/** A tool result that explicitly says `success: true`. */
function toolSucceeded(output: string): boolean {
  try {
    return (JSON.parse(output) as { success?: unknown })?.success === true;
  } catch {
    return false;
  }
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
        [CHAT_SIGNATURE_HEADER]: signChatToolRequest(clientId, body), ...agentToolHeaders(clientId),
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
