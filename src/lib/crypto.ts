import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
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
