import "server-only";
import { env } from "./env";
import { logger } from "./logger";
import { verifyRetellSignature } from "./retell";
import { getClientByIdUnsafe } from "./data/clients";
import {
  AGENT_TOOL_TOKEN_HEADER,
  CHAT_SIGNATURE_HEADER,
  SMS_SIGNATURE_HEADER,
  agentToolToken,
  safeEqual,
  verifyChatToolSignature,
  verifySmsToolSignature,
} from "./agent-tool-token";

/**
 * Authenticate an agent-tool callback (book / cancel / message / waitlist /
 * availability / transfer). These endpoints are public to Clerk because their
 * callers are machines, so every request must prove two things:
 *
 * 1. **Which business it's for** — the `?token=` in the URL must be that
 *    client's own token, HMAC(AGENT_TOOLS_SECRET, clientId). A token lifted
 *    from one business's config can't be pointed at another by editing
 *    `?client=`.
 * 2. **Who sent it** — a valid `x-retell-signature` (Retell signs custom
 *    function calls with the API key, same scheme as its webhooks), or a valid
 *    `x-frontdesk-chat-signature` from our own web-chat route. The channel the
 *    handlers see (`voice` vs `web_chat`) comes from WHICH signature verified,
 *    never from the request body, because the cancel tool trusts voice callers
 *    and web-chat visitors very differently.
 *
 * Backward compatibility: agents published before this change still carry the
 * old shared secret as their token until they're re-synced. That legacy token
 * is accepted ONLY on a Retell-signed request whose `call.agent_id` is the
 * client's own agent — so it can't be replayed across tenants or used without
 * Retell. Once every agent has been re-synced (Settings → Re-sync agents), the
 * legacy branch can be deleted.
 *
 * AGENT_TOOLS_SIGNATURE_MODE=report downgrades a missing/invalid signature to a
 * log line, for the first deploy only. Default is enforce.
 */

/**
 * `sms` = our own AI text replies (src/lib/agents/text-reply.ts). Its signed
 * `call.from_number` is the Twilio-verified number that texted, so the tools
 * treat it like voice caller ID (book under it; cancel only its own bookings).
 */
export type ToolChannel = "voice" | "web_chat" | "sms";
export type ToolClient = NonNullable<Awaited<ReturnType<typeof getClientByIdUnsafe>>>;

export interface ToolCallContext {
  retellCallId?: string;
  agentId?: string;
  fromNumber?: string;
  toNumber?: string;
}

export type AgentToolAuth =
  | {
      ok: true;
      client: ToolClient;
      channel: ToolChannel;
      args: Record<string, unknown>;
      /** Retell's call id (voice only). */
      retellCallId?: string;
      call: ToolCallContext;
    }
  | { ok: false; response: Response };

const deny = (status: number, message: string): AgentToolAuth => ({
  ok: false,
  response: new Response(message, { status }),
});

function parseBody(raw: string): { args: Record<string, unknown>; call: ToolCallContext } {
  let body: Record<string, unknown> = {};
  try {
    const parsed = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed;
  } catch {
    body = {};
  }
  const hasWrapper = body.args && typeof body.args === "object";
  const args = (hasWrapper ? body.args : body) as Record<string, unknown>;
  const c = (body.call && typeof body.call === "object" ? body.call : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  return {
    args,
    call: {
      retellCallId: str(c.call_id),
      agentId: str(c.agent_id),
      fromNumber: str(c.from_number),
      toNumber: str(c.to_number),
    },
  };
}

/**
 * Built-in end of the migration window for pre-header credentials (query
 * `?token=` and the raw shared secret). Override with AGENT_TOOLS_LEGACY_UNTIL
 * (ISO date, or "off" to end it now). Keep it short: re-sync every agent, then
 * turn it off.
 */
export const DEFAULT_LEGACY_UNTIL = "2026-10-28T00:00:00Z";

export function legacyCredentialsAllowed(now = Date.now(), setting = env.AGENT_TOOLS_LEGACY_UNTIL): boolean {
  const v = (setting || DEFAULT_LEGACY_UNTIL).trim();
  if (v.toLowerCase() === "off") return false;
  const until = Date.parse(v);
  return Number.isFinite(until) && now < until;
}

export async function authorizeAgentTool(req: Request): Promise<AgentToolAuth> {
  const url = new URL(req.url);
  const clientId = url.searchParams.get("client") ?? "";
  const headerToken = req.headers.get(AGENT_TOOL_TOKEN_HEADER) ?? "";
  const queryToken = url.searchParams.get("token") ?? "";
  const legacyOk = legacyCredentialsAllowed();

  // Header first. A query token only during the migration window — agents
  // synced before the move still send it until they're re-synced.
  const token = headerToken || (legacyOk ? queryToken : "");

  // Reject empty token/secret outright — never let an empty match authenticate.
  if (!token || !env.AGENT_TOOLS_SECRET) {
    if (queryToken && !legacyOk) logger.warn("agent-tools.auth.query_token_expired", { clientId });
    return deny(401, "Invalid token");
  }
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) return deny(400, "Missing client");

  const tokenKind = safeEqual(token, agentToolToken(clientId))
    ? ("tenant" as const)
    : legacyOk && safeEqual(token, env.AGENT_TOOLS_SECRET)
      ? ("legacy" as const)
      : null;
  if (!tokenKind) return deny(401, "Invalid token");
  if (!headerToken) logger.info("agent-tools.auth.query_token", { clientId, tokenKind });

  // The signature covers the raw bytes, so read the body exactly once, as text.
  const raw = await req.text();
  const { args, call } = parseBody(raw);

  let channel: ToolChannel;
  const chatSig = req.headers.get(CHAT_SIGNATURE_HEADER);
  const smsSig = req.headers.get(SMS_SIGNATURE_HEADER);
  if (chatSig && smsSig) {
    return deny(401, "Invalid signature");
  }
  if (smsSig) {
    if (tokenKind !== "tenant" || !verifySmsToolSignature(clientId, raw, smsSig)) {
      logger.warn("agent-tools.auth.bad_sms_signature", { clientId });
      return deny(401, "Invalid signature");
    }
    channel = "sms";
  } else if (chatSig) {
    // Our own chat route always uses the per-tenant token; a legacy token with
    // a chat signature is not something we ever send.
    if (tokenKind !== "tenant" || !verifyChatToolSignature(clientId, raw, chatSig)) {
      logger.warn("agent-tools.auth.bad_chat_signature", { clientId });
      return deny(401, "Invalid signature");
    }
    channel = "web_chat";
  } else {
    const signed = verifyRetellSignature(raw, req.headers.get("x-retell-signature"));
    if (!signed) {
      if (env.AGENT_TOOLS_SIGNATURE_MODE !== "report") {
        logger.warn("agent-tools.auth.unsigned_rejected", { clientId, tokenKind });
        return deny(401, "Invalid signature");
      }
      logger.warn("agent-tools.auth.unsigned_allowed_report_mode", { clientId, tokenKind });
    }
    channel = "voice";
  }

  const client = await getClientByIdUnsafe(clientId);
  if (!client) return { ok: false, response: Response.json({ error: "Client not found" }, { status: 404 }) };

  if (channel === "voice" && client.retellAgentId && call.agentId && call.agentId !== client.retellAgentId) {
    // A Retell-signed call from a DIFFERENT agent than this business's. With a
    // per-tenant token that means a misconfiguration; with the legacy shared
    // token it is exactly the cross-tenant replay this module exists to stop.
    logger.warn("agent-tools.auth.agent_mismatch", { clientId, tokenKind });
    if (tokenKind === "legacy") return deny(401, "Invalid token");
  }
  if (tokenKind === "legacy") {
    if (!client.retellAgentId || call.agentId !== client.retellAgentId) {
      logger.warn("agent-tools.auth.legacy_unbound", { clientId });
      if (env.AGENT_TOOLS_SIGNATURE_MODE !== "report") return deny(401, "Invalid token");
    }
    logger.info("agent-tools.auth.legacy_token", { clientId });
  }

  return { ok: true, client, channel, args, retellCallId: call.retellCallId, call };
}
