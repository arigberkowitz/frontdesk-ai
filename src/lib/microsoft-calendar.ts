import "server-only";
import { env, integrations } from "./env";

/**
 * Microsoft 365 / Outlook calendar integration: OAuth connect + busy times +
 * event create/cancel via the Microsoft Graph API, mirroring google-calendar.ts.
 * All calls are raw REST. We store only the (encrypted) refresh token.
 *
 * Note on tokens: unlike Google, Microsoft ROTATES refresh tokens — each
 * refresh may return a new one. Callers get it back from `getMsTokens` and
 * must persist it, or the connection dies in ~90 days.
 */

export const MS_REDIRECT_URI = `${env.APP_URL.replace(/\/$/, "")}/api/calendar/microsoft/callback`;
const MS_AUTH_BASE = "https://login.microsoftonline.com/common/oauth2/v2.0";
const GRAPH = "https://graph.microsoft.com/v1.0";
const SCOPES = ["openid", "email", "offline_access", "Calendars.ReadWrite"].join(" ");

export function microsoftConfigured(): boolean {
  return integrations.microsoft();
}

/** Build the consent-screen URL. `state` carries the client id through the round-trip. */
export function microsoftAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env.MS_CLIENT_ID,
    redirect_uri: MS_REDIRECT_URI,
    response_type: "code",
    response_mode: "query",
    scope: SCOPES,
    prompt: "select_account",
    state,
  });
  return `${MS_AUTH_BASE}/authorize?${params.toString()}`;
}

function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const [, payload] = idToken.split(".");
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      email?: string;
      preferred_username?: string;
    };
    return json.email ?? json.preferred_username ?? null;
  } catch {
    return null;
  }
}

async function tokenRequest(body: URLSearchParams): Promise<{
  access_token: string;
  refresh_token?: string;
  id_token?: string;
}> {
  const res = await fetch(`${MS_AUTH_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Microsoft token request failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as { access_token: string; refresh_token?: string; id_token?: string };
}

/** Exchange an auth code for tokens. Returns refresh token + connected email. */
export async function exchangeMsCodeForTokens(
  code: string,
): Promise<{ refreshToken: string | null; accessToken: string; email: string | null }> {
  const data = await tokenRequest(
    new URLSearchParams({
      code,
      client_id: env.MS_CLIENT_ID,
      client_secret: env.MS_CLIENT_SECRET,
      redirect_uri: MS_REDIRECT_URI,
      grant_type: "authorization_code",
      scope: SCOPES,
    }),
  );
  return {
    refreshToken: data.refresh_token ?? null,
    accessToken: data.access_token,
    email: emailFromIdToken(data.id_token),
  };
}

/**
 * Refresh → access token. Microsoft may rotate the refresh token; when
 * `rotatedRefreshToken` comes back non-null the caller must persist it.
 */
export async function getMsTokens(
  refreshToken: string,
): Promise<{ accessToken: string; rotatedRefreshToken: string | null }> {
  const data = await tokenRequest(
    new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.MS_CLIENT_ID,
      client_secret: env.MS_CLIENT_SECRET,
      grant_type: "refresh_token",
      scope: SCOPES,
    }),
  );
  return {
    accessToken: data.access_token,
    rotatedRefreshToken:
      data.refresh_token && data.refresh_token !== refreshToken ? data.refresh_token : null,
  };
}

/** A calendar in the connected mailbox, for the "counts as busy" picker. */
export interface MsCalendar {
  id: string;
  name: string;
  isDefault: boolean;
  owner: string | null;
}

/**
 * The connected mailbox's calendars (GET /me/calendars). Calendars.ReadWrite —
 * the scope we already hold — covers this (least-privileged is ReadBasic), so
 * listing needs no new consent.
 */
export async function msListCalendars(accessToken: string): Promise<MsCalendar[]> {
  const params = new URLSearchParams({
    $select: "id,name,isDefaultCalendar,owner",
    $top: "100",
  });
  const res = await fetch(`${GRAPH}/me/calendars?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Graph list calendars failed: ${res.status}`);
  const data = (await res.json()) as {
    value?: Array<{
      id: string;
      name?: string;
      isDefaultCalendar?: boolean;
      owner?: { address?: string; name?: string };
    }>;
  };
  return (data.value ?? []).map((c) => ({
    id: c.id,
    name: c.name?.trim() || "Untitled calendar",
    isDefault: Boolean(c.isDefaultCalendar),
    owner: c.owner?.address ?? c.owner?.name ?? null,
  }));
}

async function calendarViewBusy(
  accessToken: string,
  path: string,
  timeMin: string,
  timeMax: string,
): Promise<Array<{ start: string; end: string }>> {
  const params = new URLSearchParams({
    startDateTime: timeMin,
    endDateTime: timeMax,
    $select: "start,end,showAs",
    $top: "200",
  });
  const res = await fetch(`${GRAPH}${path}?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      // Graph returns event times in this zone; UTC keeps the math simple.
      Prefer: 'outlook.timezone="UTC"',
    },
  });
  if (!res.ok) throw new Error(`Graph calendarView failed: ${res.status}`);
  const data = (await res.json()) as {
    value?: Array<{
      start: { dateTime: string };
      end: { dateTime: string };
      showAs?: string;
    }>;
  };
  return (data.value ?? [])
    .filter((e) => e.showAs !== "free")
    .map((e) => ({ start: `${e.start.dateTime}Z`, end: `${e.end.dateTime}Z` }));
}

/**
 * Busy periods from the connected mailbox's default calendar, plus any extra
 * calendars the owner marked as "counts as busy". The default calendar is the
 * one we book into: if it can't be read we throw. An extra calendar that
 * fails (deleted, unshared) is skipped with `onSkipped` — a stale side
 * calendar must never stop the business taking bookings.
 */
export async function msBusyTimes(
  accessToken: string,
  timeMin: string,
  timeMax: string,
  extraCalendarIds: string[] = [],
  onSkipped?: (calendarId: string, reason: string) => void,
): Promise<Array<{ start: string; end: string }>> {
  const busy = await calendarViewBusy(accessToken, "/me/calendarView", timeMin, timeMax);
  const extras = [...new Set(extraCalendarIds.filter((id) => id && id !== "primary"))];
  const results = await Promise.allSettled(
    extras.map((id) =>
      calendarViewBusy(accessToken, `/me/calendars/${encodeURIComponent(id)}/calendarView`, timeMin, timeMax),
    ),
  );
  results.forEach((r, i) => {
    if (r.status === "fulfilled") busy.push(...r.value);
    else onSkipped?.(extras[i], r.reason instanceof Error ? r.reason.message : String(r.reason));
  });
  return busy;
}

export interface MsEventInput {
  summary: string;
  description?: string;
  start: string; // ISO
  end: string; // ISO
  timeZone: string;
  /** Attach a Teams meeting link (video-friendly services). */
  withOnlineMeeting?: boolean;
}

/** Create an event; returns the event id and the Teams join link when requested. */
export async function msInsertEvent(
  accessToken: string,
  event: MsEventInput,
): Promise<{ id: string; meetingUrl: string | null }> {
  const base = {
    subject: event.summary,
    body: { contentType: "text" as const, content: event.description ?? "" },
    start: { dateTime: event.start, timeZone: event.timeZone },
    end: { dateTime: event.end, timeZone: event.timeZone },
  };
  const attempt = async (withMeeting: boolean) => {
    const res = await fetch(`${GRAPH}/me/events`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(
        withMeeting
          ? { ...base, isOnlineMeeting: true, onlineMeetingProvider: "teamsForBusiness" }
          : base,
      ),
    });
    if (!res.ok) throw new Error(`Graph event insert failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { id: string; onlineMeeting?: { joinUrl?: string } };
    return { id: data.id, meetingUrl: data.onlineMeeting?.joinUrl ?? null };
  };
  if (event.withOnlineMeeting) {
    try {
      return await attempt(true);
    } catch {
      // Personal accounts / mailboxes without Teams: book without the link
      // rather than failing the caller's appointment.
      return await attempt(false);
    }
  }
  return attempt(false);
}

/** Move an existing event to a new time (PATCH /me/events/{id}); keeps its id and Teams link. */
export async function msUpdateEventTime(
  accessToken: string,
  eventId: string,
  time: { start: string; end: string; timeZone: string },
): Promise<void> {
  const res = await fetch(`${GRAPH}/me/events/${encodeURIComponent(eventId)}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      start: { dateTime: time.start, timeZone: time.timeZone },
      end: { dateTime: time.end, timeZone: time.timeZone },
    }),
  });
  if (!res.ok) throw new Error(`Graph event update failed: ${res.status}`);
}

export async function msDeleteEvent(accessToken: string, eventId: string): Promise<void> {
  const res = await fetch(`${GRAPH}/me/events/${encodeURIComponent(eventId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`Graph event delete failed: ${res.status}`);
  }
}
