/**
 * Display formatters. Pure + client-safe (no server-only imports) so they're
 * shared by server components, client components, and CSV exports.
 */

/** Cents → "$1,234" (or "$1,234.56" with showCents). */
export function formatCurrencyCents(
  cents: number | null | undefined,
  opts: { showCents?: boolean } = {},
): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: opts.showCents ? 2 : 0,
    maximumFractionDigits: opts.showCents ? 2 : 0,
  }).format(cents / 100);
}

/** US phone formatting; returns the input unchanged if it doesn't look like one. */
export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return "—";
  const digits = raw.replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (local.length !== 10) return raw;
  return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
}

/**
 * A phone number as a human typed it → E.164, or null if it can't be trusted.
 *
 * Vendors are strict about this and we were not. A perfectly ordinary
 * "(408) 832-9827" reached Retell as ten bare digits, came back a 400, and took
 * down the whole agent-provisioning call — so the business couldn't publish its
 * receptionist at all, and the error it saw blamed the receptionist rather than
 * the phone field. Nobody types +1 unprompted; the app has to do it.
 *
 * Deliberately conservative. A number this can't confidently parse returns null
 * rather than a guess, because a wrong destination is worse than none: it either
 * rings a stranger or fails at the moment a caller asks for a human.
 */
export function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const hadPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;

  // Already international: trust the country code, just strip the formatting.
  // E.164 allows up to 15 digits; fewer than 8 isn't a dialable number anywhere.
  if (hadPlus) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;

  // Bare NANP: the overwhelmingly common case in this product.
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;

  // Something else — an extension, a partial number, a typo. Say so.
  return null;
}

/** True when a stored value is safe to hand to a vendor that demands E.164. */
export function isE164(raw: string | null | undefined): boolean {
  return Boolean(raw && /^\+[1-9]\d{7,14}$/.test(raw.trim()));
}

/** 0.732 → "73%". */
export function formatPercent(value: number | null | undefined, fractionDigits = 0): string {
  // null means "no data yet", which renders as an em dash rather than a number
  // we'd be inventing.
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(fractionDigits)}%`;
}

export function formatDateTime(
  value: Date | string | number | null | undefined,
  timeZone?: string,
): string {
  if (value == null) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(d);
}

/** Seconds → "3m 12s" / "45s". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}
