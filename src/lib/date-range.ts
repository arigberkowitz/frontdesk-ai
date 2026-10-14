import { wallClockToInstant } from "@/lib/hours-util";

/**
 * Turn the agent's natural-language `date_range` ("Thursday", "tomorrow",
 * "next week", "2026-10-15", "Oct 15") into an instant window, resolved
 * against the business's own calendar day — not UTC's.
 *
 * Unrecognised or empty input falls back to the old behaviour: now → +7 days.
 * The start is never earlier than `now`.
 */
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function localYmd(tz: string, at: Date) {
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "long",
  }).formatToParts(at)) p[x.type] = x.value;
  return { y: Number(p.year), m0: Number(p.month) - 1, d: Number(p.day), dow: DAYS.indexOf(p.weekday.toLowerCase()) };
}

/** Local midnight of (y, m0, d + offset) in tz. Date.UTC normalises overflow. */
function midnight(tz: string, y: number, m0: number, d: number, offset = 0): Date {
  const n = new Date(Date.UTC(y, m0, d + offset));
  return wallClockToInstant(tz, n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate(), 0, 0);
}

export function resolveDateRange(
  raw: unknown,
  tz: string,
  now = new Date(),
): { start: Date; end: Date; matched: boolean } {
  const fallback = { start: now, end: new Date(now.getTime() + 7 * 86_400_000), matched: false };
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return fallback;
  let today;
  try {
    today = localYmd(tz, now);
  } catch {
    return fallback;
  }
  const { y, m0, d, dow } = today;
  const clamp = (start: Date, end: Date) => ({
    start: start.getTime() < now.getTime() ? now : start,
    end,
    matched: true,
  });
  const days = (from: number, count: number) => clamp(midnight(tz, y, m0, d, from), midnight(tz, y, m0, d, from + count));

  if (/\btoday\b|\btonight\b/.test(s)) return days(0, 1);
  if (/\bday after tomorrow\b/.test(s)) return days(2, 1);
  if (/\btomorrow\b/.test(s)) return days(1, 1);
  if (/\bnext week\b/.test(s)) return days(((8 - dow) % 7) || 7, 7);
  if (/\bthis week\b|\bweek\b/.test(s)) return days(0, 7);

  // Explicit dates: 2026-10-15, 10/15, Oct 15 / October 15th.
  let ym: [number, number, number] | null = null;
  const iso = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  const slash = s.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  const named = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
  if (iso) ym = [Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])];
  else if (named) ym = [y, MONTHS.indexOf(named[1]), Number(named[2])];
  else if (slash) ym = [slash[3] ? Number(slash[3].length === 2 ? `20${slash[3]}` : slash[3]) : y, Number(slash[1]) - 1, Number(slash[2])];
  if (ym) {
    // A month/day already behind us this year means next year.
    if (!iso && !(slash && slash[3]) && Date.UTC(ym[0], ym[1], ym[2]) < Date.UTC(y, m0, d)) ym[0] += 1;
    const start = midnight(tz, ym[0], ym[1], ym[2]);
    const end = midnight(tz, ym[0], ym[1], ym[2], 1);
    if (end.getTime() <= now.getTime()) return fallback;
    return clamp(start, end);
  }

  const wd = DAYS.findIndex((n) => new RegExp(`\\b${n.slice(0, 3)}(${n.slice(3)})?\\b`).test(s));
  if (wd >= 0) {
    let ahead = (wd - dow + 7) % 7;
    if (/\bnext\b/.test(s) && ahead === 0) ahead = 7;
    return days(ahead, 1);
  }
  return fallback;
}
