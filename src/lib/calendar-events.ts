import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { appointments, type Appointment } from "@/db/schema";
import {
  getBookingProviderForClient,
  isOwnCalendarProvider,
  type BookingProvider,
  type ClientCalendarConnection,
} from "./booking";
import { logger } from "./logger";

/**
 * Calendar side effects that happen AFTER an appointment already exists
 * locally: pushing a hand-entered appointment to the owner's calendar, and
 * moving the event when an appointment is rescheduled.
 *
 * The rule for everything in here: the local appointment is the booking. A
 * calendar that is down, expired, or refuses the write is logged and the
 * booking stands. Nothing in this file throws.
 */

type Conn = ClientCalendarConnection & { id: string };

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function resolveProvider(client: Conn, provider?: BookingProvider | null): BookingProvider | null {
  if (provider !== undefined) return provider && provider.isConfigured() ? provider : null;
  try {
    const p = getBookingProviderForClient(client);
    return p.isConfigured() ? p : null;
  } catch {
    return null;
  }
}

async function setEventOnRow(
  clientId: string,
  appointmentId: string,
  externalBookingId: string | null,
  meetingUrl: string | null | undefined,
): Promise<void> {
  try {
    await db
      .update(appointments)
      .set(meetingUrl === undefined ? { externalBookingId } : { externalBookingId, meetingUrl })
      .where(and(eq(appointments.id, appointmentId), eq(appointments.clientId, clientId)));
  } catch (err) {
    logger.error("calendar.events.row_update_failed", { clientId, appointmentId, error: errMsg(err) });
  }
}

export type PushResult =
  | { status: "pushed"; externalBookingId: string; meetingUrl: string | null }
  | { status: "skipped" } // no Google/Outlook calendar connected
  | { status: "failed"; error: string };

/**
 * Put a hand-entered portal appointment on the owner's Google / Outlook
 * calendar, and remember the event id so a later cancel or reschedule can
 * find it. Cal.com is skipped on purpose (it would email a made-up attendee).
 */
export async function pushAppointmentToCalendar(
  client: Conn & { timezone: string },
  appt: Pick<Appointment, "id" | "startAt" | "endAt" | "customerName" | "customerPhone">,
  opts: { virtual?: boolean; provider?: BookingProvider | null } = {},
): Promise<PushResult> {
  const provider = resolveProvider(client, opts.provider);
  if (!provider || !isOwnCalendarProvider(provider)) return { status: "skipped" };
  const endMs = appt.endAt ? appt.endAt.getTime() : appt.startAt.getTime() + 30 * 60_000;
  try {
    const r = await provider.createBooking({
      startAt: appt.startAt.toISOString(),
      durationMin: Math.max(5, Math.round((endMs - appt.startAt.getTime()) / 60_000)),
      customerName: appt.customerName ?? "",
      customerPhone: appt.customerPhone ?? "",
      timezone: client.timezone,
      virtual: Boolean(opts.virtual),
      source: "manual",
    });
    await setEventOnRow(client.id, appt.id, r.externalBookingId, r.meetingUrl ?? null);
    logger.info("calendar.events.manual_pushed", { clientId: client.id, appointmentId: appt.id });
    return { status: "pushed", externalBookingId: r.externalBookingId, meetingUrl: r.meetingUrl ?? null };
  } catch (err) {
    logger.error("calendar.events.manual_push_failed", {
      clientId: client.id,
      appointmentId: appt.id,
      error: errMsg(err),
    });
    return { status: "failed", error: errMsg(err) };
  }
}

export type MoveResult = {
  /**
   * moved     — the old event was moved in place (same id / Meet / Teams link)
   * recreated — a new event was made for the new time (old one deleted if possible)
   * none      — no calendar connected, nothing to do
   * failed    — the calendar couldn't be updated; the booking stands anyway
   */
  mode: "moved" | "recreated" | "none" | "failed";
  externalBookingId: string | null;
  meetingUrl: string | null;
};

/**
 * Bring the calendar along when appointment `from` is replaced by `to`
 * (a reschedule: `to` is already reserved locally, `from` is about to be
 * cancelled). Tries an in-place move first; if the provider can't move or the
 * move fails, makes a new event and deletes the old one. Writes the resulting
 * event id onto `to`, and clears it from `from` when the event moved — so
 * cancelling `from` afterwards can never delete the moved event.
 *
 * The caller must NOT delete `from`'s calendar event itself: this function
 * has already moved or deleted it.
 */
export async function moveAppointmentEvent(
  client: Conn & { timezone: string },
  from: Pick<Appointment, "id" | "externalBookingId" | "meetingUrl">,
  to: Pick<Appointment, "id" | "startAt" | "endAt" | "customerName" | "customerPhone">,
  opts: { virtual?: boolean; provider?: BookingProvider | null } = {},
): Promise<MoveResult> {
  const provider = resolveProvider(client, opts.provider);
  if (!provider) return { mode: "none", externalBookingId: null, meetingUrl: null };
  const endMs = to.endAt ? to.endAt.getTime() : to.startAt.getTime() + 30 * 60_000;
  const durationMin = Math.max(5, Math.round((endMs - to.startAt.getTime()) / 60_000));

  if (from.externalBookingId && provider.moveBooking) {
    try {
      await provider.moveBooking(from.externalBookingId, {
        startAt: to.startAt.toISOString(),
        durationMin,
        timezone: client.timezone,
      });
      await setEventOnRow(client.id, to.id, from.externalBookingId, from.meetingUrl ?? null);
      await setEventOnRow(client.id, from.id, null, undefined);
      logger.info("calendar.events.moved", { clientId: client.id, from: from.id, to: to.id });
      return { mode: "moved", externalBookingId: from.externalBookingId, meetingUrl: from.meetingUrl ?? null };
    } catch (err) {
      logger.error("calendar.events.move_failed", {
        clientId: client.id,
        appointmentId: from.id,
        error: errMsg(err),
        detail: "Falling back to a new event for the new time and deleting the old one.",
      });
    }
  }

  let result: MoveResult = { mode: "failed", externalBookingId: null, meetingUrl: null };
  try {
    const r = await provider.createBooking({
      startAt: to.startAt.toISOString(),
      durationMin,
      customerName: to.customerName ?? "",
      customerPhone: to.customerPhone ?? "",
      timezone: client.timezone,
      virtual: Boolean(opts.virtual),
    });
    await setEventOnRow(client.id, to.id, r.externalBookingId, r.meetingUrl ?? null);
    result = { mode: "recreated", externalBookingId: r.externalBookingId, meetingUrl: r.meetingUrl ?? null };
  } catch (err) {
    logger.error("calendar.events.reschedule_create_failed", {
      clientId: client.id,
      appointmentId: to.id,
      error: errMsg(err),
      detail: "The new time is booked locally but isn't on the owner's calendar.",
    });
  }

  if (from.externalBookingId) {
    try {
      await provider.cancelBooking(from.externalBookingId, "Rescheduled via FrontDesk AI");
      await setEventOnRow(client.id, from.id, null, undefined);
    } catch (err) {
      logger.error("calendar.events.reschedule_delete_old_failed", {
        clientId: client.id,
        appointmentId: from.id,
        externalBookingId: from.externalBookingId,
        error: errMsg(err),
        detail: "The old time is still on the owner's calendar — needs manual removal.",
      });
    }
  }
  return result;
}
