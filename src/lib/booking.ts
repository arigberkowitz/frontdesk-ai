import "server-only";
import { env, integrations } from "./env";
import { decryptSecret } from "./crypto";
import { logger } from "./logger";
import {
  computeFreeSlots,
  deleteEvent,
  freeBusy,
  getAccessToken,
  insertEvent,
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
}

export interface BookingResult {
  externalBookingId: string;
  startAt: string;
  endAt: string;
}

export interface BookingProvider {
  readonly name: string;
  isConfigured(): boolean;
  getAvailability(query: AvailabilityQuery): Promise<TimeSlot[]>;
  createBooking(input: CreateBookingInput): Promise<BookingResult>;
  cancelBooking(externalBookingId: string, reason?: string): Promise<void>;
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

  async getAvailability(query: AvailabilityQuery): Promise<TimeSlot[]> {
    const token = await getAccessToken(this.config.refreshToken);
    const busy = await freeBusy(token, this.config.calendarId, query.rangeStart, query.rangeEnd);
    return computeFreeSlots({
      busy,
      businessHours: query.businessHours ?? [],
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
    const id = await insertEvent(token, this.config.calendarId, {
      summary: input.customerName ? `Appointment — ${input.customerName}` : "Appointment",
      description: `Booked by your AI receptionist.${input.customerPhone ? ` Phone: ${input.customerPhone}.` : ""}${input.notes ? `\n${input.notes}` : ""}`,
      start: start.toISOString(),
      end: end.toISOString(),
      timeZone: input.timezone,
    });
    return { externalBookingId: id, startAt: start.toISOString(), endAt: end.toISOString() };
  }

  async cancelBooking(externalBookingId: string): Promise<void> {
    const token = await getAccessToken(this.config.refreshToken);
    await deleteEvent(token, this.config.calendarId, externalBookingId);
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
  calendarProvider?: string | null;
  calendarSecret?: string | null;
  calendarId?: string | null;
}

/**
 * Resolve the booking provider for a specific business: its OWN connected
 * calendar, or nothing. No silent fallback to the shared/demo Cal.com — a real
 * business that never connected a calendar must degrade to message-taking, not
 * book invisible appointments on the platform's demo calendar.
 */
export function getBookingProviderForClient(client: ClientCalendarConnection): BookingProvider {
  const provider = client.calendarProvider ?? null;
  const secret = client.calendarSecret ?? null;
  if (provider === "calcom" && secret) {
    return new CalcomBookingProvider({
      apiKey: decryptSecret(secret),
      eventTypeId: client.calendarId ? Number(client.calendarId) : null,
    });
  }
  if (provider === "google" && secret) {
    return new GoogleCalendarBookingProvider({
      refreshToken: decryptSecret(secret),
      calendarId: client.calendarId ?? "primary",
    });
  }
  return new NullBookingProvider();
}

export function isBookingConfigured(): boolean {
  return getDefaultBookingProvider().isConfigured();
}
