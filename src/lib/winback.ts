/**
 * Win-back (Pro): once a month, text past customers who haven't been back in
 * the stretch the owner picked (a dental cleaning every 6 months, an HVAC
 * tune-up every 12). One text per customer per interval, and never to someone
 * who already has a visit on the books.
 *
 * Different from "Invite customers back" (recall.ts), which keys off a rebook
 * interval set per service. Win-back is one interval for the whole business,
 * so it works on day one without touching the service list. Both feed the same
 * per-person cap (revenue-texts.ts), so nobody gets both in the same week.
 *
 * Pure and client-safe: the settings card previews exactly what the cron sends.
 */
import { renderRevenueText, type TemplateVars } from "@/lib/revenue-texts";

export interface WinbackPreset {
  months: number;
  label: string;
}

/** The presets on the settings card. Any whole number of months 1–24 also works. */
export const WINBACK_PRESETS: readonly WinbackPreset[] = [
  { months: 3, label: "3 months (salons, pet grooming)" },
  { months: 6, label: "6 months (dental cleaning)" },
  { months: 12, label: "12 months (HVAC tune-up, yearly service)" },
];

export const DEFAULT_WINBACK_MONTHS = 6;
export const MIN_WINBACK_MONTHS = 1;
export const MAX_WINBACK_MONTHS = 24;

/**
 * Past interval + this, they've almost certainly gone elsewhere. A text two
 * years late tells them nobody noticed they left.
 */
export const WINBACK_MAX_EXTRA_DAYS = 365;

/** How far back the sweep reads appointments. */
export const WINBACK_LOOKBACK_DAYS = MAX_WINBACK_MONTHS * 31 + WINBACK_MAX_EXTRA_DAYS;

/** Most win-back texts one business sends in one run. The rest go on the next run. */
export const MAX_WINBACK_PER_RUN = 25;

const DAY = 86_400_000;
const daysFor = (months: number) => Math.round(months * 30.44);

export function clampMonths(raw: unknown): number {
  const m = Math.round(Number(raw));
  if (!Number.isFinite(m)) return DEFAULT_WINBACK_MONTHS;
  return Math.min(MAX_WINBACK_MONTHS, Math.max(MIN_WINBACK_MONTHS, m));
}

export interface WinbackSettings {
  enabled: boolean;
  months: number;
  /** Owner's English template; empty = the default. */
  template: string;
  /** "2026-11": the local month the last full sweep finished. */
  lastRunMonth: string | null;
}

/** Read the setup_flags.winback blob, filling defaults. Off unless switched on. */
export function winbackSettingsOf(
  flags: { winback?: { enabled?: boolean; months?: number; template?: string | null; lastRunMonth?: string | null } } | null | undefined,
): WinbackSettings {
  const w = flags?.winback ?? {};
  return {
    enabled: w.enabled === true,
    months: clampMonths(w.months ?? DEFAULT_WINBACK_MONTHS),
    template: (w.template ?? "").trim(),
    lastRunMonth: w.lastRunMonth ?? null,
  };
}

export interface WinbackCandidate {
  /** Their most recent visit that happened (past, not cancelled, not a no-show). */
  lastVisitAt: Date;
  /** They already have a future visit booked. */
  hasUpcoming: boolean;
  /** The last win-back text to this number, if any. */
  lastWinbackAt: Date | null;
}

/** Is this past customer due for a win-back text today? */
export function isDueForWinback(c: WinbackCandidate, months: number, now: Date): boolean {
  if (c.hasUpcoming) return false;
  const interval = daysFor(months);
  const since = (now.getTime() - c.lastVisitAt.getTime()) / DAY;
  if (since < interval) return false;
  if (since > interval + WINBACK_MAX_EXTRA_DAYS) return false;
  // At most one per customer per interval.
  if (c.lastWinbackAt && (now.getTime() - c.lastWinbackAt.getTime()) / DAY < interval) return false;
  return true;
}

export const DEFAULT_WINBACK_TEMPLATE =
  "Hi {first_name}, it's {business}. It's been a while since {service}. Want to get your next visit on the calendar? Reply to this text and we'll find a time.";

/** Spanish-speaking customers get this one. Owner edits apply to the English text. */
export const SPANISH_WINBACK_TEMPLATE =
  "Hola {first_name}, le escribe {business}. Ha pasado un tiempo desde {service}. ¿Quiere agendar su próxima visita? Responda a este mensaje y le buscamos un horario.";

/** The exact text a customer gets. `serviceName` is what they last had done, if known. */
export function winbackBody(
  vars: Omit<TemplateVars, "service"> & { serviceName?: string | null },
  opts: { language?: "en" | "es"; template?: string | null } = {},
): string {
  const language = opts.language ?? "en";
  const name = (vars.serviceName ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  const service = name ? (language === "es" ? `su ${name}` : `your ${name}`) : null;
  const template = language === "es" ? SPANISH_WINBACK_TEMPLATE : opts.template?.trim() || DEFAULT_WINBACK_TEMPLATE;
  return renderRevenueText(
    template,
    { business: vars.business, firstName: vars.firstName, service },
    language,
    language === "es" ? "su última visita" : "your last visit",
  );
}

/** "6 months" / "1 month". */
export function monthsLabel(months: number): string {
  return `${months} ${months === 1 ? "month" : "months"}`;
}
