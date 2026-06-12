import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";

/**
 * Signed, expiring token for a client's public intake link — no DB column needed.
 * Format: base64url(clientId).base64url(expiresAtMs).base64url(hmac). The HMAC over
 * "clientId.expiresAt" (keyed by AGENT_TOOLS_SECRET) makes it unforgeable; the
 * expiry caps exposure if a link leaks.
 */
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function b64url(s: string | Buffer): string {
  return Buffer.from(s).toString("base64url");
}

function sign(payload: string): string {
  return createHmac("sha256", env.AGENT_TOOLS_SECRET).update(payload).digest("base64url");
}

export function signIntakeToken(clientId: string, ttlMs: number = TTL_MS): string {
  const expiresAt = String(Date.now() + ttlMs);
  const payload = `${clientId}.${expiresAt}`;
  return `${b64url(clientId)}.${b64url(expiresAt)}.${sign(payload)}`;
}

/** Returns the clientId if the token is valid and unexpired, else null. */
export function verifyIntakeToken(token: string): string | null {
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

  const expected = sign(`${clientId}.${expiresAt}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const exp = Number(expiresAt);
  if (!Number.isFinite(exp) || Date.now() > exp) return null;
  return clientId;
}
