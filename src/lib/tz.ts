/**
 * Rendering instants in the BUSINESS's timezone — never the viewer's.
 *
 * A receptionist product has exactly one correct clock: the one the business
 * runs on. A 2pm appointment in Los Angeles must read "2:00 PM" to the owner at
 * their desk, to the operator, to a staff member travelling, and in the
 * confirmation email — otherwise the portal and the email disagree and nobody
 * can tell which is real.
 *
 * date-fns `format()` and bare `toLocale*()` both use the RUNTIME zone (the
 * browser's on the client, UTC on the server), which is why they must not be
 * used for appointment times. Everything here takes an explicit zone, so server
 * and client render identically and hydration stays quiet.
 *
 * No "server-only" marker: client components format appointment times too.
 */

/** Short zone label for the reader — "PT", "ET", "GMT+1". */
export function zoneAbbrev(timeZone: string, at: Date = new Date()): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName");
  return part?.value ?? "";
}

/** "2:00 PM" */
export function tzTime(value: Date | string | number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

/** "2:00" — no meridiem, for dense calendar cells. */
export function tzTimeShort(value: Date | string | number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(new Date(value))
    .replace(/\s?[AP]M$/i, "");
}

/** "Mon, Aug 4, 2026 · 2:00 PM" */
export function tzDateTime(value: Date | string | number, timeZone: string): string {
  const d = new Date(value);
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
  return `${date} · ${tzTime(d, timeZone)}`;
}

/** "Monday, August 4, 2026" */
export function tzDateLong(value: Date | string | number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

/**
 * "2026-08-04" for the instant **as seen in `timeZone`** — the key for bucketing
 * appointments into calendar days. Bucketing on the viewer's local date is what
 * slides a late-evening booking onto the wrong square.
 */
export function tzDayKey(value: Date | string | number, timeZone: string): string {
  // en-CA gives ISO-ish YYYY-MM-DD ordering.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

/** Today's date key in the business's zone — "is this square today?". */
export function tzTodayKey(timeZone: string, now: Date = new Date()): string {
  return tzDayKey(now, timeZone);
}
