/**
 * Pure helpers for per-business texting numbers (no DB, no server-only) so
 * they can be unit-tested and shared by the action and the data layer.
 */

/**
 * Canonical E.164 for a pasted US/Canada number, or null if it isn't one.
 * Accepts "(415) 555-0123", "415.555.0123", "+1 415 555 0123", "14155550123".
 * Twilio numbers bought for US A2P are +1; anything else is rejected rather
 * than guessed at, because a wrong number here silently misroutes texts.
 */
export function toE164(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/[^\d]/g, "");
  if (digits.length === 10) return /^[2-9]\d{2}[2-9]/.test(digits) ? `+1${digits}` : null;
  if (digits.length === 11 && digits.startsWith("1")) {
    return /^1[2-9]\d{2}[2-9]/.test(digits) ? `+${digits}` : null;
  }
  return null;
}

/** Last ten digits, for format-insensitive comparisons. */
export function last10(raw: string | null | undefined): string {
  return (raw ?? "").replace(/[^\d]/g, "").slice(-10);
}

/** Same number regardless of formatting (+1, dashes, parens). */
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = last10(a);
  return x.length === 10 && x === last10(b);
}

/** "+14155550123" → "(415) 555-0123" for display. */
export function formatUsPhone(e164: string | null | undefined): string {
  const d = last10(e164);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (e164 ?? "");
}

/** What a read-only Twilio lookup said about a pasted number. */
export interface TwilioNumberCheck {
  /** False when Twilio isn't configured, so nothing could be checked. */
  checked: boolean;
  /** The number exists in this Twilio account. */
  found: boolean;
  smsCapable: boolean;
  /** Its "A message comes in" webhook points at our /api/webhooks/twilio. */
  webhookOk: boolean;
  smsUrl: string | null;
  /** It's the shared TWILIO_FROM_NUMBER (must not be assigned to one business). */
  isShared: boolean;
}

/** A reason to refuse assigning this number, or null if it's usable. */
export function numberProblem(check: TwilioNumberCheck): string | null {
  if (check.isShared) {
    return "That's the shared number every business uses — assign a number bought for this business.";
  }
  if (!check.checked) return null; // Twilio not configured: allowed, with a warning.
  if (!check.found) {
    return "That number isn't in this Twilio account. Buy it in Twilio first (Phone Numbers → Buy a number), then paste it here.";
  }
  if (!check.smsCapable) return "That Twilio number can't send texts. Pick an SMS-capable number.";
  return null;
}
