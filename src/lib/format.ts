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

/** 0.732 → "73%". */
export function formatPercent(value: number, fractionDigits = 0): string {
  if (!Number.isFinite(value)) return "—";
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
