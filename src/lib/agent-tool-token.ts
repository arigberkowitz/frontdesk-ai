import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";

/**
 * Per-tenant credentials for the agent-tool endpoints, all derived from the one
 * AGENT_TOOLS_SECRET so no new secret has to be provisioned per business.
 *
 * - `agentToolToken(clientId)` goes in the tool URL (`?token=`). It only
 *   authenticates requests for THAT client: swapping `?client=` makes it
 *   invalid. It is not a signature — it sits in Retell's config and in access
 *   logs — so the routes also require a request signature (see
 *   agent-tools-auth.ts).
 * - `signChatToolRequest` signs our own web-chat → tool calls, the one caller
 *   that isn't Retell and so can't produce an x-retell-signature. The key is
 *   per client as well, and the signature binds the exact body and a timestamp.
 *
 * Every derivation is domain-separated ("agent-tools:v1:", "chat-tools:v1:"),
 * so none of these values can collide with each other or with the intake-link
 * HMACs that are keyed by the same secret.
 */

const TOKEN_PREFIX = "agent-tools:v1:";
const CHAT_KEY_PREFIX = "chat-tools:v1:";
/** Signed chat tool calls older than this are refused (replay window). */
export const CHAT_SIGNATURE_TOLERANCE_MS = 5 * 60_000;
export const CHAT_SIGNATURE_HEADER = "x-frontdesk-chat-signature";

function hmac(key: string, data: string, encoding: "hex" | "base64url"): string {
  return createHmac("sha256", key).update(data, "utf8").digest(encoding);
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** The `?token=` value for one client's tool URLs. Empty when the secret is unset. */
export function agentToolToken(clientId: string): string {
  if (!env.AGENT_TOOLS_SECRET || !clientId) return "";
  return hmac(env.AGENT_TOOLS_SECRET, TOKEN_PREFIX + clientId, "base64url");
}

function chatKey(clientId: string): string {
  return hmac(env.AGENT_TOOLS_SECRET, CHAT_KEY_PREFIX + clientId, "hex");
}

/** Header value for a web-chat tool call: `v=<unixMillis>,d=<hex>`. */
export function signChatToolRequest(clientId: string, rawBody: string, now = Date.now()): string {
  if (!env.AGENT_TOOLS_SECRET) return "";
  const ts = String(now);
  return `v=${ts},d=${hmac(chatKey(clientId), `${ts}.${rawBody}`, "hex")}`;
}

/** Verify a header produced by `signChatToolRequest` for this client and body. */
export function verifyChatToolSignature(
  clientId: string,
  rawBody: string,
  header: string | null | undefined,
  now = Date.now(),
): boolean {
  if (!env.AGENT_TOOLS_SECRET || !header || !clientId) return false;
  const m = /^v=(\d+),d=([0-9a-f]+)$/.exec(header.trim());
  if (!m) return false;
  const [, ts, digest] = m;
  if (Math.abs(now - Number(ts)) > CHAT_SIGNATURE_TOLERANCE_MS) return false;
  return safeEqual(hmac(chatKey(clientId), `${ts}.${rawBody}`, "hex"), digest);
}
