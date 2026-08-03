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

/** Milliseconds `timeZone` is ahead of UTC at the instant `date`. */
export function zoneOffsetMs(timeZone: string, date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const p: Record<string, string> = {};
  for (const part of parts) if (part.type !== "literal") p[part.type] = part.value;
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour) % 24,
    Number(p.minute),
    Number(p.second),
  );
  return asUtc - date.getTime();
}

/**
 * Wall-clock time in `timeZone` → the actual instant it names.
 *
 * The obvious one-pass version — read the zone's offset for the wall-clock
 * numbers pretended to be UTC, then subtract it — is wrong twice a year. On
 * 8 Mar 2026 in Los Angeles, 9:00 AM local pretended-as-UTC lands at 01:00 PST,
 * which still reads -08:00; the true offset at 9 AM that day is -07:00. So the
 * booking came out an hour late: the caller was told nine, the calendar said
 * ten, and nobody found out until someone showed up to an empty office.
 *
 * Fix: use the first pass only as a probe, then check the candidates by reading
 * each one back. An instant is right when the zone renders it as the wall clock
 * we were asked for.
 *
 *  - Normal day: one candidate, it reads back correctly.
 *  - Autumn repeat (1:30 AM happens twice): both read back correctly; we take
 *    the earlier, which is the first time the clock says it.
 *  - Spring gap (2:30 AM never happens): neither reads back; we take the later,
 *    landing on 3:30 AM. An appointment nudged forward is recoverable — one
 *    quietly moved into yesterday is not.
 */
export function wallClockToInstant(
  timeZone: string,
  y: number,
  m0: number,
  d: number,
  h: number,
  min: number,
  sec = 0,
): Date {
  const asIfUtc = Date.UTC(y, m0, d, h, min, sec);
  const probe = zoneOffsetMs(timeZone, new Date(asIfUtc));
  const refined = zoneOffsetMs(timeZone, new Date(asIfUtc - probe));

  const candidates = [asIfUtc - probe, asIfUtc - refined].sort((a, b) => a - b);
  const readsBack = (ms: number) => ms + zoneOffsetMs(timeZone, new Date(ms)) === asIfUtc;

  return new Date(candidates.find(readsBack) ?? candidates[candidates.length - 1]);
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
    return wallClockToInstant(
      timezone,
      asUtc.getUTCFullYear(),
      asUtc.getUTCMonth(),
      asUtc.getUTCDate(),
      asUtc.getUTCHours(),
      asUtc.getUTCMinutes(),
      asUtc.getUTCSeconds(),
    );
  } catch {
    // An unknown IANA name. Better to hand back the literal reading than to
    // fail the booking outright.
    return asUtc;
  }
}
