import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { env, integrations } from "./env";
import { decryptSecret, encryptSecret } from "./crypto";
import { logger } from "./logger";
import {
  computeFreeSlots,
  deleteEvent,
  freeBusyMany,
  getAccessToken,
  insertEvent,
  patchEventTime,
  type AvailabilityBlockLite,
  type BusinessHourLite,
} from "./google-calendar";

/**
 * Booking abstraction (§EPIC D). `BookingProvider` keeps the app provider-agnostic.
 * Each business books into ITS OWN connected calendar (Cal.com or Google); clients
 * that haven't connected one fall back to the shared/default Cal.com from env.
 */
export interface TimeSlot {
  startAt: string; // ISO 8601
  endAt: string; // ISO 8601
}

export interface AvailabilityQuery {
  eventTypeId?: number;
  durationMin: number;
  rangeStart: string; // ISO
  rangeEnd: string; // ISO
  timezone: string;
  /** The client's weekly hours — used by the Google provider to build slots. */
  businessHours?: BusinessHourLite[];
  /** Lunch, closures, staff leave — subtracted alongside calendar busy time. */
  blocks?: AvailabilityBlockLite[];
}

export interface CreateBookingInput {
  eventTypeId?: number;
  startAt: string; // ISO
  durationMin: number;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  notes?: string;
  timezone: string;
  /** Video-friendly service: attach a Meet/Teams link when the provider can. */
  virtual?: boolean;
  /** Who made it — sets the event description. Default "ai". */
  source?: "ai" | "manual";
}

/** A new time for an existing calendar event (reschedule). */
export interface MoveBookingInput {
  startAt: string; // ISO
  durationMin: number;
  timezone: string;
}

export interface BookingResult {
  externalBookingId: string;
  startAt: string;
  endAt: string;
  /** Google Meet / Teams join link, when one was created. */
  meetingUrl?: string | null;
}

export interface BookingProvider {
  readonly name: string;
  isConfigured(): boolean;
  getAvailability(query: AvailabilityQuery): Promise<TimeSlot[]>;
  createBooking(input: CreateBookingInput): Promise<BookingResult>;
  cancelBooking(externalBookingId: string, reason?: string): Promise<void>;
  /**
   * Busy periods on the connected calendar between two instants. Implemented
   * by providers that DON'T refuse a clashing booking themselves (Google and
   * Microsoft happily create overlapping events; Cal.com rejects them), so the
   * booking path can check a caller-named time against the real calendar.
   */
  busyBetween?(startIso: string, endIso: string): Promise<Array<{ start: string; end: string }>>;
  /**
   * Move an existing event to a new time in place (same event id, same
   * Meet/Teams link). Google and Microsoft only; Cal.com reschedules mint a
   * new booking uid, so it keeps the create-new + cancel-old path.
   */
  moveBooking?(externalBookingId: string, input: MoveBookingInput): Promise<void>;
}

/** Event text: say who made it, so the owner can tell AI bookings from their own. */
export function eventDescription(input: Pick<CreateBookingInput, "customerPhone" | "notes" | "source">): string {
  const lead = input.source === "manual" ? "Added in FrontDesk AI." : "Booked by your AI receptionist.";
  return `${lead}${input.customerPhone ? ` Phone: ${input.customerPhone}.` : ""}${input.notes ? `\n${input.notes}` : ""}`;
}

/**
 * Is this the business's own Google / Outlook calendar (as opposed to Cal.com
 * or nothing)? Manual portal appointments are pushed only to these: a Cal.com
 * booking would email a made-up attendee address.
 */
export function isOwnCalendarProvider(provider: BookingProvider): boolean {
  return provider.name === "google-calendar" || provider.name === "microsoft-calendar";
}

/** Does [startMs, endMs) overlap any busy period? Touching edges don't count. */
export function overlapsBusy(
  busy: Array<{ start: string; end: string }>,
  startMs: number,
  endMs: number,
): boolean {
  return busy.some((b) => {
    const s = Date.parse(b.start);
    const e = Date.parse(b.end);
    return Number.isFinite(s) && Number.isFinite(e) && s < endMs && e > startMs;
  });
}

/**
 * Is this exact time free on the business's connected calendar?
 *
 * The availability tool already subtracts calendar busy time from the slots it
 * offers — but a caller can name any time ("Tuesday at 3?") and the agent can
 * book it without asking for slots first. Without this, that booking lands on
 * top of the owner's dentist appointment on their Google calendar.
 *
 * Throws when the calendar can't be read; the caller treats that exactly like
 * a failed createBooking (don't tell the caller "booked").
 */
export async function calendarSlotIsFree(
  provider: BookingProvider,
  startAt: Date,
  endAt: Date,
): Promise<boolean> {
  if (!provider.busyBetween) return true;
  const busy = await provider.busyBetween(startAt.toISOString(), endAt.toISOString());
  return !overlapsBusy(busy, startAt.getTime(), endAt.getTime());
}

const CAL_API_BASE = "https://api.cal.com/v2";
const CAL_API_VERSION = "2024-08-13";
// The /slots endpoint is versioned separately (returns { data: { date: [{ start }] } }).
const CAL_SLOTS_API_VERSION = "2024-09-04";

export interface CalcomConfig {
  apiKey: string;
  eventTypeId?: number | null;
}

class CalcomBookingProvider implements BookingProvider {
  readonly name = "cal.com";

  constructor(private readonly config: CalcomConfig) {}

  isConfigured(): boolean {
    return Boolean(this.config.apiKey);
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    if (!this.isConfigured()) throw new Error("Cal.com is not configured (no API key).");
    const res = await fetch(`${CAL_API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "cal-api-version": CAL_API_VERSION,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) {
      const body = await res.text();
      logger.error("booking.calcom.error", { path, status: res.status, body: body.slice(0, 500) });
      throw new Error(`Cal.com ${path} failed: ${res.status}`);
    }
    return (await res.json()) as T;
  }

  private resolveEventTypeId(provided?: number): number {
    const id = provided ?? this.config.eventTypeId ?? undefined;
    if (id == null || Number.isNaN(Number(id))) {
      throw new Error("No Cal.com eventTypeId (connect a calendar or set one per service).");
    }
    return Number(id);
  }

  async getAvailability(query: AvailabilityQuery): Promise<TimeSlot[]> {
    const eventTypeId = this.resolveEventTypeId(query.eventTypeId);
    const params = new URLSearchParams({
      eventTypeId: String(eventTypeId),
      start: query.rangeStart,
      end: query.rangeEnd,
      timeZone: query.timezone,
    });
    const data = await this.request<{ data?: Record<string, Array<{ start: string }>> }>(
      `/slots?${params.toString()}`,
      { method: "GET", headers: { "cal-api-version": CAL_SLOTS_API_VERSION } },
    );
    const slots: TimeSlot[] = [];
    for (const day of Object.values(data.data ?? {})) {
      for (const s of day) {
        const start = new Date(s.start);
        slots.push({
          startAt: start.toISOString(),
          endAt: new Date(start.getTime() + query.durationMin * 60_000).toISOString(),
        });
      }
    }
    return slots;
  }

  async createBooking(input: CreateBookingInput): Promise<BookingResult> {
    const eventTypeId = this.resolveEventTypeId(input.eventTypeId);
    const data = await this.request<{ data: { uid: string; start: string; end: string } }>(
      `/bookings`,
      {
        method: "POST",
        body: JSON.stringify({
          eventTypeId,
          start: input.startAt,
          attendee: {
            name: input.customerName,
            email: input.customerEmail ?? `${input.customerPhone.replace(/\D/g, "")}@no-email.local`,
            phoneNumber: input.customerPhone,
            timeZone: input.timezone,
            language: "en",
          },
          bookingFieldsResponses: input.notes ? { notes: input.notes } : undefined,
        }),
      },
    );
    return {
      externalBookingId: data.data.uid,
      startAt: data.data.start,
      endAt:
        data.data.end ??
        new Date(new Date(input.startAt).getTime() + input.durationMin * 60_000).toISOString(),
    };
  }

  async cancelBooking(
    externalBookingId: string,
    reason = "Cancelled via FrontDesk AI",
  ): Promise<void> {
    await this.request(`/bookings/${externalBookingId}/cancel`, {
      method: "POST",
      body: JSON.stringify({ cancellationReason: reason }),
    });
  }
}

export interface GoogleCalendarConfig {
  refreshToken: string;
  calendarId: string;
  /** Extra calendars whose events also count as busy (owner's picks). */
  busyCalendarIds?: string[];
  /** For logs when an extra calendar can't be read. */
  clientId?: string;
}

/** Log, don't fail, when one of the owner's extra "busy" calendars can't be read. */
function logSkippedCalendar(provider: string, clientId: string | undefined) {
  return (calendarId: string, reason: string) =>
    logger.warn("booking.busy_calendar_skipped", { provider, clientId, calendarId, reason });
}

/**
 * Per-business Google Calendar. The OAuth connect flow + API calls are wired up
 * once a Google OAuth app is configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).
 */
class GoogleCalendarBookingProvider implements BookingProvider {
  readonly name = "google-calendar";

  constructor(private readonly config: GoogleCalendarConfig) {}

  isConfigured(): boolean {
    return Boolean(this.config.refreshToken && integrations.google());
  }

  private busyIds(): string[] {
    return [this.config.calendarId, ...(this.config.busyCalendarIds ?? [])];
  }

  async busyBetween(startIso: string, endIso: string) {
    const token = await getAccessToken(this.config.refreshToken);
    return freeBusyMany(token, this.busyIds(), startIso, endIso, logSkippedCalendar(this.name, this.config.clientId));
  }

  async getAvailability(query: AvailabilityQuery): Promise<TimeSlot[]> {
    const token = await getAccessToken(this.config.refreshToken);
    const busy = await freeBusyMany(
      token,
      this.busyIds(),
      query.rangeStart,
      query.rangeEnd,
      logSkippedCalendar(this.name, this.config.clientId),
    );
    return computeFreeSlots({
      busy,
      businessHours: query.businessHours ?? [],
      blocks: query.blocks ?? [],
      durationMin: query.durationMin,
      rangeStart: query.rangeStart,
      rangeEnd: query.rangeEnd,
      timezone: query.timezone,
      nowMs: Date.now(),
    });
  }

  async createBooking(input: CreateBookingInput): Promise<BookingResult> {
    const token = await getAccessToken(this.config.refreshToken);
    const start = new Date(input.startAt);
    const end = new Date(start.getTime() + input.durationMin * 60_000);
    const { id, meetingUrl } = await insertEvent(token, this.config.calendarId, {
      summary: input.customerName ? `Appointment — ${input.customerName}` : "Appointment",
      description: eventDescription(input),
      start: start.toISOString(),
      end: end.toISOString(),
      timeZone: input.timezone,
      withMeet: Boolean(input.virtual),
    });
    return {
      externalBookingId: id,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      meetingUrl,
    };
  }

  async moveBooking(externalBookingId: string, input: MoveBookingInput): Promise<void> {
    const token = await getAccessToken(this.config.refreshToken);
    const start = new Date(input.startAt);
    const end = new Date(start.getTime() + input.durationMin * 60_000);
    await patchEventTime(token, this.config.calendarId, externalBookingId, {
      start: start.toISOString(),
      end: end.toISOString(),
      timeZone: input.timezone,
    });
  }

  async cancelBooking(externalBookingId: string): Promise<void> {
    const token = await getAccessToken(this.config.refreshToken);
    await deleteEvent(token, this.config.calendarId, externalBookingId);
  }
}

export interface MicrosoftCalendarConfig {
  refreshToken: string;
  /** Extra calendars (Graph calendar ids) whose events also count as busy. */
  busyCalendarIds?: string[];
  clientId?: string;
  /** Persist a rotated refresh token — Microsoft rotates them on use. */
  onTokenRotate?: (newRefreshToken: string) => Promise<void>;
}

/**
 * Per-business Outlook / Microsoft 365 calendar via the Graph API. One-click
 * OAuth (like Google); bookings land on the connected mailbox's calendar, and
 * video-friendly services get a Teams link.
 */
class MicrosoftBookingProvider implements BookingProvider {
  readonly name = "microsoft-calendar";

  constructor(private readonly config: MicrosoftCalendarConfig) {}

  isConfigured(): boolean {
    return Boolean(this.config.refreshToken && integrations.microsoft());
  }

  private async token(): Promise<string> {
    const { getMsTokens } = await import("./microsoft-calendar");
    const { accessToken, rotatedRefreshToken } = await getMsTokens(this.config.refreshToken);
    if (rotatedRefreshToken && this.config.onTokenRotate) {
      // Best-effort: a failed persist must not fail the caller's booking.
      await this.config.onTokenRotate(rotatedRefreshToken).catch((err) =>
        logger.warn("booking.microsoft.token_rotate_persist_failed", {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
    return accessToken;
  }

  async busyBetween(startIso: string, endIso: string) {
    const { msBusyTimes } = await import("./microsoft-calendar");
    return msBusyTimes(
      await this.token(),
      startIso,
      endIso,
      this.config.busyCalendarIds ?? [],
      logSkippedCalendar(this.name, this.config.clientId),
    );
  }

  async getAvailability(query: AvailabilityQuery): Promise<TimeSlot[]> {
    const { msBusyTimes } = await import("./microsoft-calendar");
    const token = await this.token();
    const busy = await msBusyTimes(
      token,
      query.rangeStart,
      query.rangeEnd,
      this.config.busyCalendarIds ?? [],
      logSkippedCalendar(this.name, this.config.clientId),
    );
    const { computeFreeSlots: compute } = await import("./google-calendar");
    return compute({
      busy,
      businessHours: query.businessHours ?? [],
      blocks: query.blocks ?? [],
      durationMin: query.durationMin,
      rangeStart: query.rangeStart,
      rangeEnd: query.rangeEnd,
      timezone: query.timezone,
      nowMs: Date.now(),
    });
  }

  async createBooking(input: CreateBookingInput): Promise<BookingResult> {
    const { msInsertEvent } = await import("./microsoft-calendar");
    const token = await this.token();
    const start = new Date(input.startAt);
    const end = new Date(start.getTime() + input.durationMin * 60_000);
    const { id, meetingUrl } = await msInsertEvent(token, {
      summary: input.customerName ? `Appointment — ${input.customerName}` : "Appointment",
      description: eventDescription(input),
      start: start.toISOString(),
      end: end.toISOString(),
      timeZone: "UTC",
      withOnlineMeeting: Boolean(input.virtual),
    });
    return {
      externalBookingId: id,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      meetingUrl,
    };
  }

  async moveBooking(externalBookingId: string, input: MoveBookingInput): Promise<void> {
    const { msUpdateEventTime } = await import("./microsoft-calendar");
    const token = await this.token();
    const start = new Date(input.startAt);
    const end = new Date(start.getTime() + input.durationMin * 60_000);
    // Same convention as msInsertEvent: UTC instants, UTC zone.
    await msUpdateEventTime(token, externalBookingId, {
      start: start.toISOString(),
      end: end.toISOString(),
      timeZone: "UTC",
    });
  }

  async cancelBooking(externalBookingId: string): Promise<void> {
    const { msDeleteEvent } = await import("./microsoft-calendar");
    const token = await this.token();
    await msDeleteEvent(token, externalBookingId);
  }
}

class NullBookingProvider implements BookingProvider {
  readonly name = "none";
  isConfigured(): boolean {
    return false;
  }
  async getAvailability(): Promise<TimeSlot[]> {
    return [];
  }
  async createBooking(): Promise<BookingResult> {
    throw new Error("No calendar is connected for this business.");
  }
  async cancelBooking(): Promise<void> {}
}

/** The shared/default Cal.com from env — the demo calendar + fallback for unconnected clients. */
export function getDefaultBookingProvider(): BookingProvider {
  if (integrations.calcom()) {
    return new CalcomBookingProvider({
      apiKey: env.CALCOM_API_KEY,
      eventTypeId: env.CALCOM_EVENT_TYPE_ID ? Number(env.CALCOM_EVENT_TYPE_ID) : null,
    });
  }
  return new NullBookingProvider();
}

/** Fields needed to resolve a client's own connected calendar. */
export interface ClientCalendarConnection {
  /** When present, lets the Microsoft provider persist rotated refresh tokens. */
  id?: string;
  calendarProvider?: string | null;
  calendarSecret?: string | null;
  calendarId?: string | null;
  /** Extra calendars the owner marked as "counts as busy" (Google ids / Graph ids). */
  calendarBusyIds?: string[] | null;
}

/**
 * Resolve the booking provider for a specific business: its OWN connected
 * calendar, or nothing. No silent fallback to the shared/demo Cal.com — a real
 * business that never connected a calendar must degrade to message-taking, not
 * book invisible appointments on the platform's demo calendar.
 */
export function getBookingProviderForClient(client: ClientCalendarConnection): BookingProvider {
  const provider = client.calendarProvider ?? null;
  const secret = readStoredSecret(client.calendarSecret ?? null, client.id);
  if (provider === "calcom" && secret) {
    return new CalcomBookingProvider({
      apiKey: secret,
      eventTypeId: client.calendarId ? Number(client.calendarId) : null,
    });
  }
  if (provider === "google" && secret) {
    return new GoogleCalendarBookingProvider({
      refreshToken: secret,
      calendarId: client.calendarId ?? "primary",
      busyCalendarIds: client.calendarBusyIds ?? [],
      clientId: client.id,
    });
  }
  if (provider === "microsoft" && secret) {
    const clientRowId = client.id;
    return new MicrosoftBookingProvider({
      refreshToken: secret,
      busyCalendarIds: client.calendarBusyIds ?? [],
      clientId: client.id,
      onTokenRotate: clientRowId
        ? async (newToken) => {
            await db
              .update(clients)
              .set({ calendarSecret: encryptSecret(newToken) })
              .where(eq(clients.id, clientRowId));
          }
        : undefined,
    });
  }
  return new NullBookingProvider();
}

/**
 * Decrypt a stored calendar credential, or treat it as absent.
 *
 * This function is called while rendering the portal — the setup checklist asks
 * "is a calendar connected?" on every page load. It used to let decryption
 * throw, which meant a credential we can't read took down the entire portal
 * with a generic "Something went wrong" and no way for the owner to reach the
 * button that would fix it.
 *
 * A secret we can't decrypt is one we don't have. That's true whether the key
 * was rotated, the row was copied between environments, or the ciphertext is
 * corrupt — and in every one of those cases the honest state is "not
 * connected, please reconnect", which the portal already knows how to show.
 */
function readStoredSecret(secret: string | null, clientId?: string): string | null {
  if (!secret) return null;
  try {
    return decryptSecret(secret);
  } catch (err) {
    logger.error("booking.secret_unreadable", {
      clientId,
      error: err instanceof Error ? err.message : String(err),
      detail:
        "Stored calendar credential could not be decrypted — most likely encrypted under a previous CREDENTIALS_SECRET. Treating the calendar as disconnected; the owner needs to reconnect it.",
    });
    return null;
  }
}

export function isBookingConfigured(): boolean {
  return getDefaultBookingProvider().isConfigured();
}
