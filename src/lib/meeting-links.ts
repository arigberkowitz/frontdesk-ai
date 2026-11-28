import "server-only";
import type { BookingProvider, CreateBookingInput } from "./booking";
import { logger } from "./logger";
import { businessWhere } from "./appointment-messages";
import { zoomConfigured } from "./zoom";
import {
  serviceLocation,
  videoProviderLabel,
  type ServiceLocation,
  type ServiceLocationFields,
  type VideoOptions,
} from "./service-location";
import {
  ZoomAuthError,
  createZoomMeeting,
  deleteZoomMeeting,
  updateZoomMeetingTime,
  zoomConnected,
} from "./zoom";

/**
 * Meeting links for video (and phone) appointments.
 *
 * One place decides, for a booking, which link to make and who makes it, so the
 * AI phone tool, the portal's "new appointment", reschedules and the rebooking
 * texts all behave the same:
 *
 *   Google Calendar  + Meet  → Google makes the Meet link (conferenceData)
 *   Outlook          + Meet  → Teams link (the calendar's own)
 *   Google / Outlook + Zoom  → we create the Zoom meeting on the owner's
 *                              connected Zoom account, then put the join link
 *                              in the event
 *   Cal.com                  → Cal.com's own Google Meet / Zoom location
 *
 * The rule for failures: the appointment is the booking. A link that can't be
 * made never fails the booking — it comes back as a `MeetingFailure` the caller
 * turns into an owner alert, and the spoken confirmation stops promising a link.
 */

export type MeetingFailure = {
  reason: "zoom_not_connected" | "zoom_reconnect" | "zoom_error" | "no_link";
  /** For the owner's alert and the logs. */
  detail: string;
};

export interface MeetingPlan {
  location: ServiceLocation;
  /** Spread into provider.createBooking(). */
  fields: Pick<CreateBookingInput, "virtual" | "meetingUrl" | "videoProvider" | "locationType" | "locationText">;
  /** Zoom meeting already created for this booking (clean it up if the event fails). */
  zoomMeetingId: string | null;
  /** The link couldn't be set up before the event was written. */
  setupFailure: MeetingFailure | null;
}

export type MeetingClient = {
  id: string;
  name: string;
  timezone: string;
  zoomSecret?: string | null;
  calendarProvider?: string | null;
  /** The business's own address — the event location for in-person visits. */
  address?: string | null;
  industry?: string | null;
};

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Decide (and, for Zoom, create) the meeting link BEFORE the calendar event is written. Never throws. */
export async function planMeeting(opts: {
  client: MeetingClient;
  service: (ServiceLocationFields & { name?: string | null }) | null | undefined;
  provider: BookingProvider;
  startAt: Date;
  durationMin: number;
  /** A job at the customer's place: its own address is used, never the business's. */
  serviceAddress?: string | null;
}): Promise<MeetingPlan> {
  const { client, service, provider } = opts;
  const location = serviceLocation(service);
  const where =
    location.type === "in_person"
      ? businessWhere({
          locationType: "in_person",
          serviceAddress: opts.serviceAddress,
          industry: client.industry,
          address: client.address,
        })
      : null;
  const none: MeetingPlan = {
    location,
    fields: { locationType: location.type, ...(where ? { locationText: where.address } : {}) },
    zoomMeetingId: null,
    setupFailure: null,
  };
  if (location.type !== "video") return none;

  const videoProvider = location.videoProvider ?? "meet";
  // Cal.com picks its own Meet / Zoom location from the event type.
  if (provider.name === "cal.com") {
    return { ...none, fields: { locationType: "video", videoProvider } };
  }
  if (videoProvider === "meet") {
    return { ...none, fields: { locationType: "video", virtual: true } };
  }

  // Zoom on a Google / Outlook calendar.
  const base: MeetingPlan = { ...none, fields: { locationType: "video" } };
  if (!zoomConnected(client)) {
    return {
      ...base,
      setupFailure: {
        reason: "zoom_not_connected",
        detail: "This service sends Zoom links, but Zoom isn't connected. Connect it in Settings → Calendar.",
      },
    };
  }
  try {
    const topic = `${service?.name ? `${service.name} — ` : ""}${client.name}`;
    const m = await createZoomMeeting(client, {
      topic,
      startIso: opts.startAt.toISOString(),
      durationMin: opts.durationMin,
      timezone: client.timezone,
    });
    return {
      ...base,
      fields: { locationType: "video", meetingUrl: m.joinUrl },
      zoomMeetingId: m.id,
    };
  } catch (err) {
    const reconnect = err instanceof ZoomAuthError;
    logger.error("meeting.zoom_create_failed", { clientId: client.id, reconnect, error: errMsg(err) });
    return {
      ...base,
      setupFailure: {
        reason: reconnect ? "zoom_reconnect" : "zoom_error",
        detail: reconnect
          ? "Zoom access expired or was removed. Reconnect Zoom in Settings → Calendar."
          : `Zoom couldn't create the meeting (${errMsg(err).slice(0, 160)}).`,
      },
    };
  }
}

/**
 * After the event is written: was the link actually made? Returns the failure
 * to alert on, or null. A video service with no link is a failure even when
 * setup looked fine (Google refused Meet, Outlook had no Teams, Cal.com's event
 * type lacks the location).
 */
export function checkMeetingResult(plan: MeetingPlan, meetingUrl: string | null | undefined): MeetingFailure | null {
  if (plan.location.type !== "video") return null;
  if (plan.setupFailure) return plan.setupFailure;
  if (meetingUrl) return null;
  return {
    reason: "no_link",
    detail:
      plan.fields.videoProvider || plan.fields.virtual
        ? "The calendar didn't return a video link for this booking."
        : "No video link was created for this booking.",
  };
}

/** Best-effort: remove a Zoom meeting whose booking didn't happen or was cancelled. Never throws. */
export async function discardZoomMeeting(client: MeetingClient, zoomMeetingId: string | null | undefined): Promise<void> {
  if (!zoomMeetingId || !client.zoomSecret) return;
  try {
    await deleteZoomMeeting(client, zoomMeetingId);
  } catch (err) {
    logger.warn("meeting.zoom_delete_failed", { clientId: client.id, zoomMeetingId, error: errMsg(err) });
  }
}

/** Best-effort: keep a Zoom meeting's time in step with a rescheduled appointment. Never throws. */
export async function moveZoomMeeting(
  client: MeetingClient,
  zoomMeetingId: string | null | undefined,
  t: { startAt: Date; durationMin: number },
): Promise<boolean> {
  if (!zoomMeetingId || !client.zoomSecret) return false;
  try {
    await updateZoomMeetingTime(client, zoomMeetingId, {
      startIso: t.startAt.toISOString(),
      durationMin: t.durationMin,
      timezone: client.timezone,
    });
    return true;
  } catch (err) {
    logger.warn("meeting.zoom_move_failed", { clientId: client.id, zoomMeetingId, error: errMsg(err) });
    return false;
  }
}

/**
 * What the agent is told after a booking, so the spoken confirmation is true.
 * "I've sent you a video link" is said ONLY when a link exists AND it actually
 * went to the caller (calendar invite to their email, or the confirmation text
 * they agreed to). On text and web chat the customer is already reading our
 * reply, so the link goes straight into it.
 */
export function meetingNote(o: {
  location: ServiceLocation;
  calendarProvider?: string | null;
  link: string | null;
  invited: boolean;
  texted: boolean;
  channel: string;
  customerPhone?: string | null;
}): string {
  if (o.location.type === "phone") {
    return ` This is a phone appointment: tell the caller we will call them${o.customerPhone ? ` at ${o.customerPhone}` : ""} at the appointment time.`;
  }
  if (o.location.type !== "video") return "";
  const label = videoProviderLabel(o.location.videoProvider, o.calendarProvider);
  if (!o.link) {
    return ` This is a video appointment, but the ${label} link could not be created. Do NOT say a link was sent. Tell the caller the team will send the video link before the appointment.`;
  }
  if (o.channel === "sms" || o.channel === "web_chat") {
    return ` This is a video appointment (${label}). Put this join link in your reply: ${o.link}`;
  }
  if (o.invited || o.texted) {
    const how = o.invited && o.texted ? "by email and by text" : o.invited ? "by email" : "by text";
    return ` This is a video appointment (${label}). The video link has been sent to the caller ${how}. Tell them: "I've sent you a video link" (in Spanish: "Le envié un enlace de video"). Do not read the link aloud.`;
  }
  return ` This is a video appointment (${label}), but there is no email on the booking and the caller didn't agree to texts, so the link has NOT reached them. Do NOT say you sent a link. Tell the caller the team will send the video link before the appointment.`;
}

/** The video choices to show this business on the services form. */
export function videoOptionsFor(client: { zoomSecret?: string | null; calendarProvider?: string | null }): VideoOptions {
  return {
    zoomReady: zoomConfigured(),
    zoomConnected: Boolean(client.zoomSecret),
    calendarProvider: client.calendarProvider ?? null,
  };
}
