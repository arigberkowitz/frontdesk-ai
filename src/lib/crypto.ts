import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { env } from "./env";

/**
 * Symmetric encryption for secrets we must store at rest (per-client calendar
 * API keys / OAuth refresh tokens). AES-256-GCM with a key derived from
 * CREDENTIALS_SECRET. Payload format: base64(iv):base64(tag):base64(ciphertext).
 *
 * In dev a fallback key keeps things working, but production MUST set
 * CREDENTIALS_SECRET (a long random string) — rotating it invalidates stored
 * secrets, so clients would need to reconnect.
 */
function key(): Buffer {
  const secret = env.CREDENTIALS_SECRET || "dev-insecure-credentials-secret";
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(":");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Malformed encrypted payload.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/* ----------------------------- portal edit code --------------------------
 * The admin picks a code; staff enter it to unlock AI-configuration editing.
 * We store only a keyed hash (never the code), and the unlock state is a
 * signed, expiring token in a cookie — nothing to store server-side.
 * ------------------------------------------------------------------------ */

export function hashEditCode(clientId: string, code: string): string {
  return createHmac("sha256", key()).update(`${clientId}:${code.trim()}`).digest("base64url");
}

export function verifyEditCode(clientId: string, code: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashEditCode(clientId, code));
  const stored = Buffer.from(storedHash);
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}

const UNLOCK_TTL_MS = 12 * 60 * 60 * 1000; // a shift, not forever

export function signUnlockToken(clientId: string, userId: string): string {
  const exp = Date.now() + UNLOCK_TTL_MS;
  const payload = `${clientId}.${userId}.${exp}`;
  const sig = createHmac("sha256", key()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyUnlockToken(
  token: string | undefined,
  clientId: string,
  userId: string,
): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 4) return false;
  const [cid, uid, expStr, sig] = parts;
  if (cid !== clientId || uid !== userId) return false;
  if (Number(expStr) < Date.now()) return false;
  const expected = createHmac("sha256", key()).update(`${cid}.${uid}.${expStr}`).digest("base64url");
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}
