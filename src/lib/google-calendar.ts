import "server-only";
import { env, integrations } from "./env";
import { wallClockToInstant } from "./hours-util";

/**
 * Google Calendar integration (§EPIC D): OAuth connect + free/busy availability
 * + event create/cancel, so each business's bookings land in its OWN calendar.
 * All calls are raw REST (no SDK). Tokens: we store only the refresh token
 * (encrypted) and exchange it for a short-lived access token per request.
 */

// Must point at the public app URL in production (baked into the OAuth round-trip).
export const GOOGLE_REDIRECT_URI = `${env.APP_URL.replace(/\/$/, "")}/api/calendar/google/callback`;
const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar"].join(" ");

export function googleConfigured(): boolean {
  return integrations.google();
}

/** Build the consent-screen URL. `state` carries the client id through the round-trip. */
export function googleAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const [, payload] = idToken.split(".");
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { email?: string };
    return json.email ?? null;
  } catch {
    return null;
  }
}

/** Exchange an auth code for tokens. Returns the long-lived refresh token + connected email. */
export async function exchangeCodeForTokens(
  code: string,
): Promise<{ refreshToken: string | null; accessToken: string; email: string | null }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    id_token?: string;
  };
  return {
    refreshToken: data.refresh_token ?? null,
    accessToken: data.access_token,
    email: emailFromIdToken(data.id_token),
  };
}

/** Exchange a stored refresh token for a fresh access token. */
export async function getAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google token refresh failed: ${res.status}`);
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

export async function freeBusy(
  accessToken: string,
  calendarId: string,
  timeMin: string,
  timeMax: string,
): Promise<Array<{ start: string; end: string }>> {
  const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ timeMin, timeMax, items: [{ id: calendarId }] }),
  });
  if (!res.ok) throw new Error(`Google freeBusy failed: ${res.status}`);
  const data = (await res.json()) as {
    calendars: Record<string, { busy?: Array<{ start: string; end: string }> }>;
  };
  return data.calendars[calendarId]?.busy ?? [];
}

export async function insertEvent(
  accessToken: string,
  calendarId: string,
  event: {
    summary: string;
    description?: string;
    start: string;
    end: string;
    timeZone: string;
    /** Attach a Google Meet link (video-friendly services). */
    withMeet?: boolean;
  },
): Promise<{ id: string; meetingUrl: string | null }> {
  const qs = event.withMeet ? "?conferenceDataVersion=1" : "";
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events${qs}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        summary: event.summary,
        description: event.description,
        start: { dateTime: event.start, timeZone: event.timeZone },
        end: { dateTime: event.end, timeZone: event.timeZone },
        ...(event.withMeet
          ? {
              conferenceData: {
                createRequest: {
                  requestId: crypto.randomUUID(),
                  conferenceSolutionKey: { type: "hangoutsMeet" },
                },
              },
            }
          : {}),
      }),
    },
  );
  if (!res.ok) throw new Error(`Google event insert failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { id: string; hangoutLink?: string };
  return { id: data.id, meetingUrl: data.hangoutLink ?? null };
}

export async function deleteEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`Google event delete failed: ${res.status}`);
  }
}

/* --------------------------- timezone-aware slots ------------------------- */

/**
 * A Date for local Y/M/D H:M in `timeZone`.
 *
 * Shares one implementation with the agent's datetime parsing — this used to be
 * a second copy of the same single-pass offset lookup, and so had the same
 * DST bug in a second place. Slot generation and booking must agree about what
 * "9 AM" means or the calendar disagrees with the confirmation.
 */
export function zonedTime(timeZone: string, y: number, m0: number, d: number, h: number, min: number): Date {
  return wallClockToInstant(timeZone, y, m0, d, h, min);
}

export interface BusinessHourLite {
  dayOfWeek: number;
  isClosed: boolean;
  openTime: string | null;
  closeTime: string | null;
}

/**
 * A window the business is closed for despite its weekly hours — lunch, a
 * holiday, someone on leave. Recurring rows carry startTime/endTime (+ an
 * optional dayOfWeek); one-off rows carry absolute startsAt/endsAt.
 */
export interface AvailabilityBlockLite {
  dayOfWeek?: number | null;
  startTime?: string | null;
  endTime?: string | null;
  startsAt?: Date | string | null;
  endsAt?: Date | string | null;
}

/** Why availability came back empty — so the agent can say something true. */
export type NoSlotsReason =
  | "no_hours" // nobody ever set opening hours
  | "all_booked" // hours exist, every slot is taken or blocked
  | "none"; // slots were found

export interface AvailabilityResult {
  slots: Array<{ startAt: string; endAt: string }>;
  reason: NoSlotsReason;
}

/** Absolute [start,end) windows that a block covers inside one local day. */
function blockWindowsForDay(
  blocks: AvailabilityBlockLite[],
  tz: string,
  y: number,
  mo: number,
  dd: number,
  dow: number,
): Array<readonly [number, number]> {
  const out: Array<readonly [number, number]> = [];
  for (const b of blocks) {
    if (b.startsAt && b.endsAt) {
      // One-off: already absolute, applies to whatever days it spans.
      out.push([new Date(b.startsAt).getTime(), new Date(b.endsAt).getTime()] as const);
      continue;
    }
    if (!b.startTime || !b.endTime) continue;
    // Recurring: null dayOfWeek means every day.
    if (b.dayOfWeek != null && b.dayOfWeek !== dow) continue;
    const [sh, sm] = b.startTime.split(":").map(Number);
    const [eh, em] = b.endTime.split(":").map(Number);
    if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) continue;
    out.push([
      zonedTime(tz, y, mo, dd, sh, sm).getTime(),
      zonedTime(tz, y, mo, dd, eh, em).getTime(),
    ] as const);
  }
  return out;
}

/**
 * Open slots = the business-hours grid (in the client's tz) minus busy periods,
 * future-only. A simple, calendar-respecting availability for Google.
 */
export function computeFreeSlots(opts: {
  busy: Array<{ start: string; end: string }>;
  businessHours: BusinessHourLite[];
  /** Lunch breaks, closures, staff leave — subtracted like calendar busy. */
  blocks?: AvailabilityBlockLite[];
  durationMin: number;
  rangeStart: string;
  rangeEnd: string;
  timezone: string;
  nowMs: number;
  limit?: number;
}): Array<{ startAt: string; endAt: string }> {
  return computeAvailability(opts).slots;
}

/**
 * Same grid as `computeFreeSlots`, but it also reports WHY it came back empty.
 *
 * That distinction is the whole point: an empty list can mean "genuinely booked
 * solid" or "this business never set opening hours". Collapsing both into `[]`
 * is what let the agent tell callers a wide-open week was fully booked.
 */
export function computeAvailability(opts: {
  busy: Array<{ start: string; end: string }>;
  businessHours: BusinessHourLite[];
  blocks?: AvailabilityBlockLite[];
  durationMin: number;
  rangeStart: string;
  rangeEnd: string;
  timezone: string;
  nowMs: number;
  limit?: number;
}): AvailabilityResult {
  const { timezone: tz, durationMin, nowMs } = opts;
  const limit = opts.limit ?? 8;
  const blocks = opts.blocks ?? [];
  const byDay = new Map(opts.businessHours.map((h) => [h.dayOfWeek, h]));
  const busy = opts.busy.map((b) => [Date.parse(b.start), Date.parse(b.end)] as const);
  const rangeEndMs = Date.parse(opts.rangeEnd);
  const slotMs = durationMin * 60_000;
  const out: Array<{ startAt: string; endAt: string }> = [];

  // Did any day in the window actually have opening hours? Distinguishes
  // "closed solid" from "never configured".
  let sawOpenDay = false;

  const startDate = new Date(opts.rangeStart);
  for (let i = 0; i < 14 && out.length < limit; i++) {
    const day = new Date(startDate.getTime() + i * 86_400_000);
    const ymd: Record<string, string> = {};
    for (const part of new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
    }).formatToParts(day))
      if (part.type !== "literal") ymd[part.type] = part.value;
    const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(ymd.weekday);
    const bh = byDay.get(dow);
    if (!bh || bh.isClosed || !bh.openTime || !bh.closeTime) continue;
    sawOpenDay = true;

    const [oh, om] = bh.openTime.split(":").map(Number);
    const [ch, cm] = bh.closeTime.split(":").map(Number);
    const y = Number(ymd.year);
    const mo = Number(ymd.month) - 1;
    const dd = Number(ymd.day);
    const open = zonedTime(tz, y, mo, dd, oh, om).getTime();
    const close = zonedTime(tz, y, mo, dd, ch, cm).getTime();

    // Calendar busy plus this day's blocks are the same kind of obstacle.
    const dayBlocks = blockWindowsForDay(blocks, tz, y, mo, dd, dow);
    const blocked = (s: number, e: number) =>
      busy.some(([bs, be]) => s < be && e > bs) ||
      dayBlocks.some(([bs, be]) => s < be && e > bs);

    for (let t = open; t + slotMs <= close && out.length < limit; t += slotMs) {
      if (t > nowMs && t < rangeEndMs && !blocked(t, t + slotMs)) {
        out.push({ startAt: new Date(t).toISOString(), endAt: new Date(t + slotMs).toISOString() });
      }
    }
  }

  const reason: NoSlotsReason = out.length > 0 ? "none" : sawOpenDay ? "all_booked" : "no_hours";
  return { slots: out, reason };
}
