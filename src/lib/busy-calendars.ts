import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { decryptSecret, encryptSecret } from "./crypto";
import { freeBusyRaw, getAccessToken } from "./google-calendar";
import { getMsTokens, msListCalendars, type MsCalendar } from "./microsoft-calendar";
import { logger } from "./logger";

/**
 * "Which calendars count as busy?" — the owner's picks on top of the calendar
 * we book into.
 *
 * Microsoft: we list the mailbox's calendars (GET /me/calendars works under
 * the Calendars.ReadWrite scope we already hold) and the owner ticks boxes.
 *
 * Google: listing calendars (calendarList.list) needs
 * calendar.calendarlist.readonly or broader — a NEW scope, which would reopen
 * Google's verification review. So there is no Google list. The owner types a
 * calendar's ID (Google Calendar → Settings → the calendar → "Calendar ID")
 * and we check it with freeBusy, which only needs calendar.freebusy.
 */

export const MAX_BUSY_CALENDARS = 10;

export interface BusyCalendarConn {
  id: string;
  calendarProvider?: string | null;
  calendarSecret?: string | null;
  calendarId?: string | null;
  calendarBusyIds?: string[] | null;
}

function secretOf(client: BusyCalendarConn): string | null {
  if (!client.calendarSecret) return null;
  try {
    return decryptSecret(client.calendarSecret);
  } catch {
    return null;
  }
}

/** Trim, de-dupe, drop blanks and the booking calendar itself, cap the count. */
export function normalizeBusyIds(
  raw: unknown[],
  bookingCalendarId?: string | null,
  limit = MAX_BUSY_CALENDARS,
): string[] {
  const out: string[] = [];
  for (const v of raw) {
    const id = String(v ?? "").trim();
    if (!id || id.length > 300) continue;
    if (id === "primary" || id === bookingCalendarId) continue;
    if (!out.includes(id)) out.push(id);
  }
  return out.slice(0, limit);
}

/** A Microsoft access token for this client, persisting a rotated refresh token. */
async function msAccessToken(client: BusyCalendarConn): Promise<string> {
  const secret = secretOf(client);
  if (!secret) throw new Error("Calendar credential unreadable — reconnect.");
  const { accessToken, rotatedRefreshToken } = await getMsTokens(secret);
  if (rotatedRefreshToken) {
    await db
      .update(clients)
      .set({ calendarSecret: encryptSecret(rotatedRefreshToken) })
      .where(eq(clients.id, client.id))
      .catch((err: unknown) =>
        logger.warn("busy_calendars.ms_rotate_persist_failed", {
          clientId: client.id,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
  }
  return accessToken;
}

export type OwnerCalendars =
  | { kind: "microsoft"; calendars: MsCalendar[] }
  | { kind: "google_manual" } // no list without a new scope; IDs are typed in
  | { kind: "unsupported" } // Cal.com / nothing connected
  | { kind: "error"; message: string };

/** What the settings picker can show for this business. Never throws. */
export async function loadOwnerCalendars(client: BusyCalendarConn): Promise<OwnerCalendars> {
  if (client.calendarProvider === "google") return { kind: "google_manual" };
  if (client.calendarProvider !== "microsoft") return { kind: "unsupported" };
  try {
    return { kind: "microsoft", calendars: await msListCalendars(await msAccessToken(client)) };
  } catch (err) {
    logger.warn("busy_calendars.ms_list_failed", {
      clientId: client.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return { kind: "error", message: "We couldn't load your Outlook calendars just now. Try again in a minute, or reconnect." };
  }
}

/**
 * Check typed Google calendar IDs with one freeBusy call. Returns the IDs
 * Google can't see (unshared, typo, deleted) with its reason.
 */
export async function checkGoogleCalendarIds(
  client: BusyCalendarConn,
  ids: string[],
): Promise<{ ok: true } | { ok: false; bad: Array<{ id: string; reason: string }> } | { ok: false; error: string }> {
  if (ids.length === 0) return { ok: true };
  const secret = secretOf(client);
  if (!secret) return { ok: false, error: "Your Google connection needs to be reconnected first." };
  try {
    const token = await getAccessToken(secret);
    const now = new Date();
    const byCal = await freeBusyRaw(
      token,
      ids,
      now.toISOString(),
      new Date(now.getTime() + 86_400_000).toISOString(),
    );
    const bad = ids
      .filter((id) => byCal[id]?.error)
      .map((id) => ({ id, reason: byCal[id]!.error as string }));
    return bad.length ? { ok: false, bad } : { ok: true };
  } catch (err) {
    logger.warn("busy_calendars.google_check_failed", {
      clientId: client.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: "We couldn't reach Google to check those calendars — try again in a minute." };
  }
}

/** Keep only Microsoft calendar ids that are really in this mailbox (never the default). */
export function filterMicrosoftIds(ids: string[], calendars: MsCalendar[]): string[] {
  const allowed = new Set(calendars.filter((c) => !c.isDefault).map((c) => c.id));
  return ids.filter((id) => allowed.has(id));
}
