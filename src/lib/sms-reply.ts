/**
 * Pure rules for an owner's typed reply from portal → Messages. No DB, no
 * server-only, so the composer and the server action produce byte-identical
 * text and the rules can be unit-tested.
 */
import { MAX_BODY_CHARS, withOptOut } from "./lead-followup-text";

/** Longest reply we'll send — the same four-text ceiling as lead follow-ups. */
export const MAX_REPLY_CHARS = MAX_BODY_CHARS;

/** `sms_messages.kind` for a reply typed in the portal. */
export const PORTAL_REPLY_KIND = "portal_reply";

/** Durable caps (counted from sms_messages over a rolling 24h). */
export const PORTAL_REPLIES_PER_THREAD_PER_DAY = 20;
export const PORTAL_REPLIES_PER_CLIENT_PER_DAY = 100;

export type ReplyValidation = { ok: true; text: string } | { ok: false; error: string };

/** Trim, then reject empty or over-long input. */
export function validateReply(raw: unknown): ReplyValidation {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return { ok: false, error: "Type a message first." };
  if (text.length > MAX_REPLY_CHARS) {
    return {
      ok: false,
      error: `Keep it under ${MAX_REPLY_CHARS} characters — that's four texts already.`,
    };
  }
  return { ok: true, text };
}

/**
 * The text that actually goes out.
 *
 * - Every business sends from ONE shared Twilio number, so a bare "See you at
 *   3!" arrives from a number the customer can't tell apart from another
 *   business. Unless the owner already named the business, the reply is
 *   prefixed "Business Name: ".
 * - `includeOptOut` appends "Reply STOP to opt out." — used when the customer
 *   has never texted this business (the consent path), exactly like an
 *   owner's lead follow-up. A reply inside a conversation the customer started
 *   doesn't repeat it on every message.
 */
export function composeReply(
  text: string,
  opts: { businessName?: string | null; includeOptOut: boolean },
): string {
  const trimmed = text.trim();
  const name = (opts.businessName ?? "").trim();
  const named = !name || trimmed.toLowerCase().includes(name.toLowerCase());
  const body = named ? trimmed : `${name}: ${trimmed}`;
  return opts.includeOptOut ? withOptOut(body) : body;
}
