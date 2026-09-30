/**
 * The OAuth `state` round-trip for calendar connect (Google + Microsoft), as
 * pure functions so both providers share one format and it can be tested.
 *
 * state = "<clientId>:<nonce>[:<from>]" — the nonce is matched against a
 * one-time httpOnly cookie (CSRF); `from` only picks which portal page the
 * owner lands back on, from a fixed allowlist, so it can't become an open
 * redirect.
 */

export type CalendarReturn = "appointments" | "settings";

export function calendarReturnFrom(raw: string | null | undefined): CalendarReturn {
  return raw === "settings" ? "settings" : "appointments";
}

export function buildCalendarOAuthState(clientId: string, nonce: string, from: CalendarReturn): string {
  return from === "appointments" ? `${clientId}:${nonce}` : `${clientId}:${nonce}:${from}`;
}

export function parseCalendarOAuthState(state: string | null | undefined): {
  clientId: string;
  nonce: string;
  from: CalendarReturn;
} {
  const [clientId = "", nonce = "", from] = (state ?? "").split(":");
  return { clientId, nonce, from: calendarReturnFrom(from) };
}

/** Where the owner lands after the OAuth round-trip, with the outcome for the toast. */
export function calendarReturnPath(from: CalendarReturn, status: string): string {
  const page = from === "settings" ? "/portal/settings/calendar" : "/portal/appointments";
  return `${page}?calendar=${encodeURIComponent(status)}`;
}
