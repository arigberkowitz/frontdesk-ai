/**
 * After-hours computation in the client's local timezone (§C2). Pure + testable.
 */
export interface DayHours {
  dayOfWeek: number;
  isClosed: boolean;
  openTime?: string | null;
  closeTime?: string | null;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
};

/** Local "HH:MM" + weekday index for an instant, in the given IANA timezone. */
export function localTimeParts(at: Date, timezone: string): { dayOfWeek: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);

  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = get("weekday");
  let hour = Number(get("hour"));
  if (hour === 24) hour = 0; // some runtimes emit "24" for midnight
  const minute = Number(get("minute"));
  return { dayOfWeek: WEEKDAY_INDEX[weekday] ?? 0, minutes: hour * 60 + minute };
}

function toMinutes(hhmm: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * True when `at` falls outside the client's open hours (closed day, no hours
 * configured, or outside the open–close window). Defaults to open if a day has
 * hours but they can't be parsed.
 */
export function isAfterHours(at: Date, timezone: string, hours: DayHours[]): boolean {
  if (!hours.length) return false; // unknown hours → don't flag
  const { dayOfWeek, minutes } = localTimeParts(at, timezone);
  const day = hours.find((h) => h.dayOfWeek === dayOfWeek);
  if (!day || day.isClosed) return true;
  if (!day.openTime || !day.closeTime) return true;
  const open = toMinutes(day.openTime);
  const close = toMinutes(day.closeTime);
  if (open == null || close == null) return false;
  return minutes < open || minutes >= close;
}

/**
 * Parse a tool-supplied datetime in the CLIENT's timezone. Strings with an
 * explicit offset ("...Z", "+05:00") are trusted; naive strings
 * ("2026-07-23T14:00:00") are interpreted as wall-clock time in `timezone` —
 * not server/UTC time, which silently books the wrong hour.
 */
export function parseInClientTimezone(raw: string, timezone: string): Date | null {
  const s = raw.trim();
  if (!s) return null;
  if (/(z|[+-]\d{2}:?\d{2})$/i.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const asUtc = new Date(`${s}Z`);
  if (Number.isNaN(asUtc.getTime())) return null;
  try {
    const m = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "longOffset" })
      .format(asUtc)
      .match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    if (!m) return asUtc;
    const sign = m[1] === "-" ? -1 : 1;
    const offsetMin = sign * (Number(m[2]) * 60 + Number(m[3] ?? 0));
    return new Date(asUtc.getTime() - offsetMin * 60_000);
  } catch {
    return asUtc;
  }
}
