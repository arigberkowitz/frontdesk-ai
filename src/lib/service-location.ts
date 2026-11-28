/**
 * Where a service happens: in person, by phone, or by video.
 *
 * Pure (no server-only imports) so the services form, the prompt builder and
 * the booking path all read the same rules.
 *
 * `virtualOk` is the older single switch ("can be done by video"). It stays in
 * the database, kept in step on every save, so a rollback or a stale reader
 * still sees the right answer, and rows written before `location_type` existed
 * (virtualOk = true, no location type) read as video on the calendar's own
 * link — exactly what they did before.
 */

export const LOCATION_TYPES = ["in_person", "phone", "video"] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];

/**
 * Who makes the video link.
 *  - "meet": the business's calendar does. Google Calendar → Google Meet,
 *    Outlook → Microsoft Teams, Cal.com → the Google Meet location on the event type.
 *  - "zoom": a Zoom meeting made through the business's connected Zoom account
 *    (or Cal.com's Zoom location when the calendar is Cal.com).
 */
export const VIDEO_PROVIDERS = ["meet", "zoom"] as const;
export type VideoProvider = (typeof VIDEO_PROVIDERS)[number];

export interface ServiceLocationFields {
  locationType?: string | null;
  videoProvider?: string | null;
  virtualOk?: boolean | null;
}

export interface ServiceLocation {
  type: LocationType;
  /** Only set when type is "video". */
  videoProvider: VideoProvider | null;
}

export function serviceLocation(s: ServiceLocationFields | null | undefined): ServiceLocation {
  if (!s) return { type: "in_person", videoProvider: null };
  const raw = s.locationType as LocationType | null | undefined;
  if (raw === "video" || (!raw && s.virtualOk)) {
    return { type: "video", videoProvider: s.videoProvider === "zoom" ? "zoom" : "meet" };
  }
  if (raw === "phone") return { type: "phone", videoProvider: null };
  return { type: "in_person", videoProvider: null };
}

export function isVideoService(s: ServiceLocationFields | null | undefined): boolean {
  return serviceLocation(s).type === "video";
}

/** "Google Meet" / "Zoom" — the Outlook calendar's Teams link is named by the caller that knows the calendar. */
export function videoProviderLabel(p: VideoProvider | null, calendarProvider?: string | null): string {
  if (p === "zoom") return "Zoom";
  return calendarProvider === "microsoft" ? "Microsoft Teams" : "Google Meet";
}

/** The three columns/fields a service save writes, always consistent. */
export function locationFieldsForSave(input: {
  locationType: LocationType;
  videoProvider?: VideoProvider | null;
}): { locationType: LocationType; videoProvider: VideoProvider | null; virtualOk: boolean } {
  const video = input.locationType === "video";
  return {
    locationType: input.locationType,
    videoProvider: video ? (input.videoProvider === "zoom" ? "zoom" : "meet") : null,
    virtualOk: video,
  };
}

/**
 * What the services form needs to know about the business to offer the right
 * video choices. Computed on the server (the form can't see the Zoom secret).
 */
export interface VideoOptions {
  /** ZOOM_CLIENT_ID/SECRET are set — the Zoom choice only exists then. */
  zoomReady: boolean;
  /** This business has connected its Zoom account. */
  zoomConnected: boolean;
  /** "google" | "microsoft" | "calcom" | null — names the built-in link (Meet / Teams). */
  calendarProvider: string | null;
}
