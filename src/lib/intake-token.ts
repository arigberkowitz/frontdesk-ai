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
/** Links live 7 days. Verification refuses anything claiming a longer life. */
export const TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Clock skew allowance on the "no longer than TTL" check. */
const SKEW_MS = 5 * 60_000;

/**
 * Where a setup link sends you once the business's owner has signed in (see
 * `ownerHasSignedIn`). The expiry above still applies on top of this.
 */
export const INTAKE_USED_SIGN_IN = "/sign-in?reason=setup-link-used";
const SUBKEY_LABEL = "intake-link:v1";
/** Last moment a legacy (raw-secret) token may still be valid. See above. */
export const LEGACY_TOKEN_CUTOFF_MS = Date.parse("2026-11-30T00:00:00Z");

function b64url(s: string | Buffer): string {
  return Buffer.from(s).toString("base64url");
}

/**
 * The signing key: INTAKE_LINK_SECRET, its own secret. Until that's set, the
 * old subkey derived from AGENT_TOOLS_SECRET (transition only).
 */
function intakeKey(): Buffer | string | null {
  if (env.INTAKE_LINK_SECRET) return env.INTAKE_LINK_SECRET;
  return derivedKey();
}

function derivedKey(): Buffer | null {
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
  return verifyIntakeLink(token, now)?.clientId ?? null;
}

/**
 * Valid, unexpired link → its client and when it was issued (expiry − TTL).
 * A token whose expiry is more than one TTL away is refused: that caps every
 * link, including 30-day ones minted before the cut to 7 days, at 7 days from
 * now. `issuedAt` lets callers lock links issued before intake was completed.
 */
export function verifyIntakeLink(token: string, now = Date.now()): { clientId: string; issuedAt: number } | null {
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
  if (exp - now > TTL_MS + SKEW_MS) return null;
  const ok = { clientId, issuedAt: exp - TTL_MS };

  const payload = `${clientId}.${expiresAt}`;
  if (safeEqual(sig, sign(payload, key))) return ok;

  // Links signed with the derived subkey before INTAKE_LINK_SECRET was set.
  // Same cutoff rule: only links that expire by the cutoff, so a forged one
  // can't outlive the transition.
  const derived = env.INTAKE_LINK_SECRET ? derivedKey() : null;
  if (derived && exp <= LEGACY_TOKEN_CUTOFF_MS && safeEqual(sig, sign(payload, derived))) return ok;

  // Links issued before the subkey existed (see the header comment).
  if (env.AGENT_TOOLS_SECRET && exp <= LEGACY_TOKEN_CUTOFF_MS && safeEqual(sig, sign(payload, env.AGENT_TOOLS_SECRET))) {
    return ok;
  }
  return null;
}
