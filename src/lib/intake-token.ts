import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";

/**
 * Signed, expiring token for a client's public intake link — no DB column needed.
 * Format: base64url(clientId).base64url(expiresAtMs).base64url(hmac). The HMAC over
 * "clientId.expiresAt" makes it unforgeable; the expiry caps exposure if a link leaks.
 *
 * Key: a DEDICATED subkey, HMAC(AGENT_TOOLS_SECRET, "intake-link:v1"), not the
 * agent-tools secret itself. That secret has been baked into Retell tool URLs
 * (and so into Retell's dashboard and access logs); signing intake links with
 * it directly meant anyone who saw a tool URL could mint an intake link for any
 * business. Deriving a subkey needs no new env var, and knowing the subkey
 * reveals nothing about the parent secret or the tool tokens.
 *
 * Old links: tokens signed with the raw secret before this change are still
 * accepted, but only if they expire on or before LEGACY_TOKEN_CUTOFF_MS. Links
 * last 30 days, so every genuine old link has expired well before the cutoff,
 * and after that date the legacy branch is dead code (delete it then). A forged
 * legacy token can't be given a later expiry to outlive the cutoff.
 *
 * An unset secret fails closed: nothing signs, nothing verifies.
 */
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SUBKEY_LABEL = "intake-link:v1";
/** Last moment a legacy (raw-secret) token may still be valid. See above. */
export const LEGACY_TOKEN_CUTOFF_MS = Date.parse("2026-11-30T00:00:00Z");

function b64url(s: string | Buffer): string {
  return Buffer.from(s).toString("base64url");
}

function intakeKey(): Buffer | null {
  if (!env.AGENT_TOOLS_SECRET) return null;
  return createHmac("sha256", env.AGENT_TOOLS_SECRET).update(SUBKEY_LABEL).digest();
}

function sign(payload: string, key: Buffer | string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function signIntakeToken(clientId: string, ttlMs: number = TTL_MS, now = Date.now()): string {
  const key = intakeKey();
  const expiresAt = String(now + ttlMs);
  const payload = `${clientId}.${expiresAt}`;
  // No secret → an unsignable link. Emit something that can never verify
  // rather than an HMAC keyed by the empty string.
  const sig = key ? sign(payload, key) : "unsigned";
  return `${b64url(clientId)}.${b64url(expiresAt)}.${sig}`;
}

/** Returns the clientId if the token is valid and unexpired, else null. */
export function verifyIntakeToken(token: string, now = Date.now()): string | null {
  const key = intakeKey();
  if (!key) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [idB64, expB64, sig] = parts;
  let clientId: string;
  let expiresAt: string;
  try {
    clientId = Buffer.from(idB64, "base64url").toString("utf8");
    expiresAt = Buffer.from(expB64, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const exp = Number(expiresAt);
  if (!Number.isFinite(exp) || now > exp) return null;

  const payload = `${clientId}.${expiresAt}`;
  if (safeEqual(sig, sign(payload, key))) return clientId;

  // Links issued before the subkey existed (see the header comment).
  if (exp <= LEGACY_TOKEN_CUTOFF_MS && safeEqual(sig, sign(payload, env.AGENT_TOOLS_SECRET))) {
    return clientId;
  }
  return null;
}
