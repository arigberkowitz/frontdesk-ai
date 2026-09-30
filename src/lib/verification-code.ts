import "server-only";
import { createHmac } from "node:crypto";
import { env } from "./env";
import { safeEqual } from "./agent-tool-token";
import { normalizePhone } from "./data/sms-optouts";

/**
 * One-time codes that prove a web-chat visitor holds the phone an appointment
 * was booked under, before we reveal or cancel it.
 *
 * Stateless on purpose: the code is HMAC(secret, client | phone | window),
 * truncated to 6 digits, so there's no table to migrate and nothing to sweep —
 * any serverless instance can check a code any other instance sent. A code is
 * valid for the window it was issued in plus the next one (10–20 minutes), and
 * it only unlocks that one business's appointments for that one number.
 *
 * Six digits are only as strong as the attempt limit in front of them; callers
 * MUST throttle `checkVerificationCode` per (client, phone).
 */

export const CODE_WINDOW_MS = 10 * 60_000;
const PREFIX = "cancel-otp:v1:";

function codeFor(clientId: string, phone: string, window: number): string {
  const mac = createHmac("sha256", env.AGENT_TOOLS_SECRET)
    .update(`${PREFIX}${clientId}:${normalizePhone(phone)}:${window}`)
    .digest();
  return String(mac.readUInt32BE(0) % 1_000_000).padStart(6, "0");
}

/** The code to text right now for this client + phone, or "" if unconfigured. */
export function issueVerificationCode(clientId: string, phone: string, now = Date.now()): string {
  if (!env.AGENT_TOOLS_SECRET || !normalizePhone(phone)) return "";
  return codeFor(clientId, phone, Math.floor(now / CODE_WINDOW_MS));
}

/** True when `code` is the current or previous window's code for this client + phone. */
export function checkVerificationCode(
  clientId: string,
  phone: string,
  code: string,
  now = Date.now(),
): boolean {
  if (!env.AGENT_TOOLS_SECRET || !normalizePhone(phone)) return false;
  const given = String(code ?? "").replace(/\D/g, "");
  if (given.length !== 6) return false;
  const w = Math.floor(now / CODE_WINDOW_MS);
  // Check both windows without short-circuiting, so timing doesn't say which.
  const cur = safeEqual(given, codeFor(clientId, phone, w));
  const prev = safeEqual(given, codeFor(clientId, phone, w - 1));
  return cur || prev;
}

/** The text a visitor receives. Business-branded; says what to do if unexpected. */
export function verificationCodeText(businessName: string, code: string): string {
  return `${businessName}: your code to manage your appointment is ${code}. It expires in 10 minutes. Didn't ask for this? You can ignore this text. Reply STOP to opt out.`;
}
