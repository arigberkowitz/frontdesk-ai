import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { env, integrations } from "./env";
import { decryptSecret, encryptSecret } from "./crypto";
import { logger } from "./logger";

/**
 * Zoom, per business (video bookings).
 *
 * A Zoom "General app" (user-managed OAuth). The owner clicks Connect Zoom,
 * approves, and we create meetings on THEIR Zoom account when a video
 * appointment is booked. Raw REST, no SDK, same shape as google-calendar.ts.
 *
 * Tokens: Zoom ROTATES the refresh token on every refresh (the old one dies at
 * once) and access tokens last an hour. So we store both, encrypted, in one
 * column, reuse the access token until it's about to expire, and write a
 * rotated refresh token back with a compare-and-set so two bookings refreshing
 * at the same moment can't overwrite each other with a dead token.
 *
 * Scopes the Zoom app needs (granular, set in the Zoom Marketplace app, not in
 * the authorize URL): meeting:write:meeting, meeting:update:meeting,
 * meeting:delete:meeting, user:read:user.
 */

// A function, not a constant: read at call time so importing this module never touches env.
export function zoomRedirectUri(): string {
  return `${env.APP_URL.replace(/\/$/, "")}/api/calendar/zoom/callback`;
}

const ZOOM_OAUTH = "https://zoom.us/oauth";
const ZOOM_API = "https://api.zoom.us/v2";

export function zoomConfigured(): boolean {
  return integrations.zoom();
}

/** Has this business connected a Zoom account (and is the Zoom app configured)? */
export function zoomConnected(client: { zoomSecret?: string | null }): boolean {
  return Boolean(client.zoomSecret) && zoomConfigured();
}

/** The reconnect-needed case: the refresh token is dead or access was revoked. */
export class ZoomAuthError extends Error {
  constructor(message = "Zoom access expired or was removed — reconnect Zoom in Settings → Calendar.") {
    super(message);
    this.name = "ZoomAuthError";
  }
}

export interface ZoomTokens {
  /** refresh token (rotates on every refresh) */
  r: string;
  /** current access token */
  a: string;
  /** access token expiry, epoch ms */
  e: number;
}

export function zoomAuthUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.ZOOM_CLIENT_ID,
    redirect_uri: zoomRedirectUri(),
    state,
  });
  return `${ZOOM_OAUTH}/authorize?${params.toString()}`;
}

function basicAuth(): string {
  return `Basic ${Buffer.from(`${env.ZOOM_CLIENT_ID}:${env.ZOOM_CLIENT_SECRET}`).toString("base64")}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

function toTokens(d: TokenResponse): ZoomTokens {
  if (!d.refresh_token) throw new Error("Zoom did not return a refresh token.");
  // Refresh a minute early so a token never expires mid-request.
  return { r: d.refresh_token, a: d.access_token, e: Date.now() + (d.expires_in ?? 3600) * 1000 - 60_000 };
}

async function tokenRequest(params: Record<string, string>): Promise<{ ok: true; tokens: ZoomTokens } | { ok: false; status: number; body: string }> {
  const res = await fetch(`${ZOOM_OAUTH}/token`, {
    method: "POST",
    headers: { Authorization: basicAuth(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  if (!res.ok) return { ok: false, status: res.status, body: (await res.text()).slice(0, 300) };
  return { ok: true, tokens: toTokens((await res.json()) as TokenResponse) };
}

/** Exchange the OAuth code, and read the connected account's email for display. */
export async function exchangeZoomCode(code: string): Promise<{ tokens: ZoomTokens; email: string | null }> {
  const r = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: zoomRedirectUri() });
  if (!r.ok) throw new Error(`Zoom token exchange failed: ${r.status} ${r.body}`);
  let email: string | null = null;
  try {
    const me = await fetch(`${ZOOM_API}/users/me`, { headers: { Authorization: `Bearer ${r.tokens.a}` } });
    if (me.ok) email = ((await me.json()) as { email?: string }).email ?? null;
  } catch {
    /* display only */
  }
  return { tokens: r.tokens, email };
}

export function sealZoomTokens(t: ZoomTokens): string {
  return encryptSecret(JSON.stringify(t));
}

export function openZoomTokens(secret: string): ZoomTokens | null {
  try {
    const t = JSON.parse(decryptSecret(secret)) as Partial<ZoomTokens>;
    return typeof t.r === "string" && typeof t.a === "string" && typeof t.e === "number"
      ? { r: t.r, a: t.a, e: t.e }
      : null;
  } catch {
    return null;
  }
}

type ZoomConn = { id: string; zoomSecret?: string | null };

/**
 * A usable access token for this business, refreshing (and persisting the
 * rotated refresh token) when needed. Throws ZoomAuthError when the connection
 * is dead and the owner has to reconnect.
 */
export async function getZoomAccessToken(client: ZoomConn): Promise<string> {
  if (!client.zoomSecret) throw new ZoomAuthError("Zoom isn't connected for this business.");
  let secret = client.zoomSecret;
  for (let attempt = 0; attempt < 2; attempt++) {
    const tokens = openZoomTokens(secret);
    if (!tokens) throw new ZoomAuthError("The stored Zoom connection can't be read — reconnect Zoom.");
    if (tokens.e > Date.now()) return tokens.a;

    const r = await tokenRequest({ grant_type: "refresh_token", refresh_token: tokens.r });
    if (r.ok) {
      const next = sealZoomTokens(r.tokens);
      // Compare-and-set: only replace the secret we refreshed from.
      await db
        .update(clients)
        .set({ zoomSecret: next })
        .where(and(eq(clients.id, client.id), eq(clients.zoomSecret, secret)))
        .catch((err) =>
          logger.warn("zoom.token_persist_failed", {
            clientId: client.id,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      return r.tokens.a;
    }
    // A concurrent request may have just rotated the token: read the row once
    // more and use whatever is stored now before giving up.
    if (attempt === 0) {
      const row = await db.query.clients.findFirst({
        where: eq(clients.id, client.id),
        columns: { zoomSecret: true },
      });
      if (row?.zoomSecret && row.zoomSecret !== secret) {
        secret = row.zoomSecret;
        continue;
      }
    }
    logger.error("zoom.refresh_failed", { clientId: client.id, status: r.status, body: r.body });
    if (r.status === 400 || r.status === 401) throw new ZoomAuthError();
    throw new Error(`Zoom token refresh failed: ${r.status}`);
  }
  throw new ZoomAuthError();
}

async function zoomFetch(client: ZoomConn, path: string, init: RequestInit): Promise<Response> {
  const token = await getZoomAccessToken(client);
  const res = await fetch(`${ZOOM_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (res.status === 401) throw new ZoomAuthError();
  return res;
}

/** Zoom wants UTC without milliseconds: 2031-03-04T20:00:00Z. */
function zoomTime(iso: string): string {
  return new Date(iso).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export interface ZoomMeeting {
  id: string;
  joinUrl: string;
}

/**
 * Create a scheduled meeting on the business's Zoom account. A waiting room is
 * on: the link is texted and emailed, so the owner admits the person they
 * expect instead of anyone holding the link walking in.
 */
export async function createZoomMeeting(
  client: ZoomConn,
  m: { topic: string; startIso: string; durationMin: number; timezone: string; agenda?: string },
): Promise<ZoomMeeting> {
  const res = await zoomFetch(client, "/users/me/meetings", {
    method: "POST",
    body: JSON.stringify({
      topic: m.topic.slice(0, 200),
      type: 2,
      start_time: zoomTime(m.startIso),
      duration: m.durationMin,
      timezone: m.timezone,
      agenda: m.agenda?.slice(0, 1000),
      settings: { waiting_room: true, join_before_host: false, host_video: true, participant_video: true },
    }),
  });
  if (!res.ok) throw new Error(`Zoom create meeting failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  const d = (await res.json()) as { id?: number | string; join_url?: string };
  if (!d.id || !d.join_url) throw new Error("Zoom create meeting returned no join link.");
  return { id: String(d.id), joinUrl: d.join_url };
}

/** Move a meeting to a new time (a reschedule). */
export async function updateZoomMeetingTime(
  client: ZoomConn,
  meetingId: string,
  t: { startIso: string; durationMin: number; timezone: string },
): Promise<void> {
  const res = await zoomFetch(client, `/meetings/${encodeURIComponent(meetingId)}`, {
    method: "PATCH",
    body: JSON.stringify({ start_time: zoomTime(t.startIso), duration: t.durationMin, timezone: t.timezone }),
  });
  if (!res.ok && res.status !== 404) throw new Error(`Zoom update meeting failed: ${res.status}`);
}

/** Delete a meeting. Already gone (404) counts as deleted. */
export async function deleteZoomMeeting(client: ZoomConn, meetingId: string): Promise<void> {
  const res = await zoomFetch(client, `/meetings/${encodeURIComponent(meetingId)}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error(`Zoom delete meeting failed: ${res.status}`);
}

/**
 * Revoke the grant at Zoom, so "Disconnect" means we can no longer reach the
 * account at all (not just that we forgot the token). Best-effort.
 */
export async function revokeZoomTokens(tokens: ZoomTokens): Promise<boolean> {
  try {
    const res = await fetch(`${ZOOM_OAUTH}/revoke`, {
      method: "POST",
      headers: { Authorization: basicAuth(), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: tokens.a }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
