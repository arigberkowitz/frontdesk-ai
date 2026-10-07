import "server-only";
import { and, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { appointments, type Appointment, type Client, type RebookOfferRow } from "@/db/schema";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import { listActiveBlocks } from "@/lib/data/availability-blocks";
import { cancelAppointment, hasOverlappingAppointment, reserveAppointment } from "@/lib/data/appointments";
import { findFreeProvider } from "@/lib/data/providers";
import { isOptedOut, normalizePhone } from "@/lib/data/sms-optouts";
import { hasSmsConsent } from "@/lib/data/sms-consents";
import {
  confirmationWasSent,
  findOpenOfferForPhone,
  insertOffer,
  latestOffersFor,
  markOfferReplied,
  offersSentLastDay,
  transitionOffer,
} from "@/lib/data/rebook-offers";
import { calendarSlotIsFree, getBookingProviderForClient, type BookingProvider } from "@/lib/booking";
import { moveAppointmentEvent } from "@/lib/calendar-events";
import { businessWideBlocks, checkSlot, type AvailabilityBlockLite } from "@/lib/booking-window";
import { withinTextingHours } from "@/lib/appointment-messages";
import { offerFreedSlot } from "@/lib/agents/waitlist-backfill";
import { toE164 } from "@/lib/format";
import { notifier } from "@/lib/notifier";
import { logger } from "@/lib/logger";
import {
  AFFECTED_LOOKAHEAD_DAYS,
  MAX_REBOOK_TEXTS_PER_DAY,
  REBOOK_MIN_LEAD_HOURS,
  REBOOK_OFFER_HOURS,
  REBOOK_SEARCH_DAYS,
  cancelledText,
  isAffected,
  offerText,
  parseRebookReply,
  pickSpreadSlots,
  rescheduledText,
  slotGoneText,
  type Slot,
} from "@/lib/rebook";

/**
 * Smart rebooking — the server side.
 *
 *  1. listAffectedAppointments: what the owner's blocks now sit on top of.
 *  2. sendRebookOffers: ONLY from the owner's explicit confirmation in the
 *     portal. Texts each customer 2–3 open times (fixed template).
 *  3. handleRebookReply: from the Twilio webhook. "1/2/3" reschedules through
 *     the same checks and calls the voice agent's booking tool makes (hours,
 *     blocks, capacity / free team member, real-calendar free/busy, atomic
 *     reserve, release the calendar event on failure), then cancels the old
 *     appointment the way the cancel tool does. "NO" cancels. Anything else
 *     goes to the owner.
 *
 * Who may move an appointment by text: only the phone number it's booked
 * under — the offer is looked up by the number that texted, which is the same
 * caller-ID rule the voice cancel tool applies.
 */

export const REBOOK_OFFER_KIND = "rebook_offer";
export const REBOOK_REPLY_KIND = "rebook_reply";

type FullClient = NonNullable<Awaited<ReturnType<typeof getClientByIdUnsafe>>>;
type Service = FullClient["services"][number];

export interface AffectedAppointment {
  id: string;
  customerName: string | null;
  customerPhone: string | null;
  serviceName: string | null;
  startAt: Date;
  offer: RebookOfferRow | null;
}

async function upcomingAppointments(clientId: string, now: Date, ids?: string[]): Promise<Appointment[]> {
  return db.query.appointments.findMany({
    where: and(
      eq(appointments.clientId, clientId),
      isNull(appointments.deletedAt),
      inArray(appointments.status, ["booked", "confirmed"]),
      gte(appointments.startAt, now),
      lte(appointments.startAt, new Date(now.getTime() + AFFECTED_LOOKAHEAD_DAYS * 86_400_000)),
      ...(ids ? [inArray(appointments.id, ids)] : []),
    ),
    orderBy: (a, { asc }) => [asc(a.startAt)],
    limit: 1000,
  });
}

/** Booked appointments that an active block (closure, time off, a person's leave) now overlaps. */
export async function listAffectedAppointments(clientId: string, now = new Date()): Promise<AffectedAppointment[]> {
  const client = await getClientByIdUnsafe(clientId);
  if (!client) return [];
  const blocks = await listActiveBlocks(clientId);
  if (blocks.length === 0) return [];
  const appts = (await upcomingAppointments(clientId, now)).filter((a) => isAffected(a, blocks, client.timezone));
  const offers = await latestOffersFor(clientId, appts.map((a) => a.id));
  const serviceName = new Map(client.services.map((s) => [s.id, s.name]));
  return appts.map((a) => ({
    id: a.id,
    customerName: a.customerName,
    customerPhone: a.customerPhone,
    serviceName: a.serviceId ? (serviceName.get(a.serviceId) ?? null) : null,
    startAt: a.startAt,
    offer: offers.get(a.id) ?? null,
  }));
}

/** How many booked appointments this one block lands on (for the "added" toast). */
export async function countAffectedByBlock(
  clientId: string,
  block: AvailabilityBlockLite,
  tz: string,
  now = new Date(),
): Promise<number> {
  const appts = await upcomingAppointments(clientId, now);
  return appts.filter((a) => isAffected(a, [block], tz)).length;
}

/** Same checks the booking tool runs before writing, minus the calendar call. */
async function slotIsBookable(
  client: FullClient,
  service: Service | null,
  blocks: AvailabilityBlockLite[],
  startAt: Date,
  endAt: Date,
): Promise<{ ok: true; providerId: string | null } | { ok: false }> {
  const verdict = checkSlot({
    hours: client.businessHours,
    blocks: businessWideBlocks(blocks),
    tz: client.timezone,
    startMs: startAt.getTime(),
    endMs: endAt.getTime(),
  });
  if (verdict === "closed" || verdict === "blocked") return { ok: false };
  if (client.staffModeEnabled) {
    const free = await findFreeProvider(client.id, startAt, endAt, null, { blocks, timezone: client.timezone });
    return free ? { ok: true, providerId: free.id } : { ok: false };
  }
  if (await hasOverlappingAppointment(client.id, startAt, endAt, service)) return { ok: false };
  return { ok: true, providerId: null };
}

function durationOf(appt: Appointment, service: Service | null): number {
  if (service?.durationMin) return service.durationMin;
  if (appt.endAt) return Math.max(15, Math.round((appt.endAt.getTime() - appt.startAt.getTime()) / 60_000));
  return 30;
}

/** Permission to text this customer about this appointment. */
async function mayText(client: Pick<Client, "id">, appt: Appointment, phone: string): Promise<string | null> {
  if (await isOptedOut(phone, client.id)) return "opted_out";
  const consented =
    (await hasSmsConsent(client.id, phone, "rebook")) || (await confirmationWasSent(client.id, appt.id));
  return consented ? null : "no_consent";
}

export interface SendSummary {
  sent: number;
  skipped: Record<string, number>;
}

/**
 * Text each selected, still-affected appointment's customer 2–3 open times.
 * Called ONLY from the owner's confirmed portal action. Never automatic.
 */
export async function sendRebookOffers(
  clientId: string,
  appointmentIds: string[],
  actorId: string,
  now = new Date(),
): Promise<SendSummary | { error: string }> {
  const client = await getClientByIdUnsafe(clientId);
  if (!client) return { error: "Business not found." };
  if (!client.smartRebookingEnabled) {
    return { error: "Turn on rebooking texts in Settings → Follow-ups first." };
  }
  if (!withinTextingHours(now, client.timezone)) {
    return { error: "It's outside texting hours where you are (9am–8pm). Try again in the morning." };
  }

  const blocks = await listActiveBlocks(clientId);
  const appts = (await upcomingAppointments(clientId, now, appointmentIds)).filter((a) =>
    isAffected(a, blocks, client.timezone),
  );
  const existing = await latestOffersFor(clientId, appts.map((a) => a.id));

  let provider: BookingProvider | null = null;
  try {
    provider = getBookingProviderForClient(client);
    if (!provider.isConfigured()) provider = null;
  } catch {
    provider = null;
  }

  const summary: SendSummary = { sent: 0, skipped: {} };
  const skip = async (appt: Appointment, phoneKey: string, reason: string) => {
    summary.skipped[reason] = (summary.skipped[reason] ?? 0) + 1;
    await insertOffer({
      clientId,
      appointmentId: appt.id,
      customerPhone: phoneKey,
      status: "skipped",
      skipReason: reason,
      createdBy: actorId,
    });
  };

  // Times already offered in this batch, so customers aren't racing each other.
  const promised = new Set<string>();
  const slotCache = new Map<number, Slot[]>();
  let budget = MAX_REBOOK_TEXTS_PER_DAY - (await offersSentLastDay(clientId));

  for (const appt of appts) {
    const prior = existing.get(appt.id);
    // Already handled or in flight — never text the same customer twice about one appointment.
    if (prior && ["sent", "processing", "rescheduled", "cancelled"].includes(prior.status)) continue;

    const to = toE164(appt.customerPhone ?? "");
    const phoneKey = to ? normalizePhone(to) : "";
    if (!to || !/^\+1\d{10}$/.test(to)) {
      await skip(appt, phoneKey, "no_phone");
      continue;
    }
    const denied = await mayText(client, appt, to);
    if (denied) {
      await skip(appt, phoneKey, denied);
      continue;
    }
    if (budget <= 0) {
      await skip(appt, phoneKey, "daily_cap");
      continue;
    }
    if (!provider) {
      await skip(appt, phoneKey, "no_calendar");
      continue;
    }

    const service = client.services.find((s) => s.id === appt.serviceId) ?? null;
    const durationMin = durationOf(appt, service);
    let candidates = slotCache.get(durationMin);
    if (!candidates) {
      try {
        candidates = await provider.getAvailability({
          durationMin,
          rangeStart: new Date(now.getTime() + REBOOK_MIN_LEAD_HOURS * 3_600_000).toISOString(),
          rangeEnd: new Date(now.getTime() + REBOOK_SEARCH_DAYS * 86_400_000).toISOString(),
          timezone: client.timezone,
          businessHours: client.businessHours,
          blocks: businessWideBlocks(blocks),
        });
      } catch (err) {
        logger.error("rebook.availability_failed", {
          clientId,
          error: err instanceof Error ? err.message : String(err),
        });
        candidates = [];
      }
      slotCache.set(durationMin, candidates);
    }

    // Spread the picks, then confirm each against the same rules booking uses.
    const shortlist = pickSpreadSlots(candidates, {
      tz: client.timezone,
      exclude: promised,
      notBefore: new Date(now.getTime() + REBOOK_MIN_LEAD_HOURS * 3_600_000),
      count: 6,
    });
    const slots: Slot[] = [];
    for (const s of shortlist) {
      if (slots.length >= 3) break;
      const ok = await slotIsBookable(client, service, blocks, new Date(s.startAt), new Date(s.endAt));
      if (ok.ok) slots.push(s);
    }
    if (slots.length < 2) {
      await skip(appt, phoneKey, "no_slots");
      continue;
    }

    const offer = await insertOffer({
      clientId,
      appointmentId: appt.id,
      customerPhone: phoneKey,
      slots,
      status: "sent",
      sentAt: now,
      expiresAt: new Date(now.getTime() + REBOOK_OFFER_HOURS * 3_600_000),
      createdBy: actorId,
    });
    if (!offer) continue; // someone else just sent it

    const result = await notifier.sendSms({
      to,
      body: offerText({
        businessName: client.name,
        serviceName: service?.name ?? null,
        oldStartAt: appt.startAt,
        slots,
        tz: client.timezone,
      }),
      log: { clientId, kind: REBOOK_OFFER_KIND, appointmentId: appt.id },
    });
    if (result.skipped || !result.ok) {
      await transitionOffer(offer.id, "sent", {
        status: result.skipped ? "skipped" : "failed",
        skipReason: result.skipped ? "sms_not_configured" : (result.error ?? "send failed").slice(0, 200),
      });
      summary.skipped[result.skipped ? "sms_not_configured" : "failed"] =
        (summary.skipped[result.skipped ? "sms_not_configured" : "failed"] ?? 0) + 1;
      continue;
    }
    for (const s of slots) promised.add(s.startAt);
    budget -= 1;
    summary.sent += 1;
  }

  logger.info("rebook.offers_sent", { clientId, actorId, ...summary });
  return summary;
}

/** The open offer a text from `from` answers, if this business has the feature on. */
export async function findOpenOffer(client: Pick<Client, "id" | "smartRebookingEnabled">, from: string, now = new Date()) {
  if (!client.smartRebookingEnabled) return null;
  const key = normalizePhone(from);
  if (!key) return null;
  return findOpenOfferForPhone(client.id, key, now);
}

export type ReplyOutcome =
  | { handled: true; result: "rescheduled" | "cancelled"; alertOwner: false }
  | { handled: true; result: "slot_gone" | "appointment_gone"; alertOwner: true }
  | { handled: false; result: "unclear" | "already_handled"; alertOwner: true };

async function replyToCustomer(client: Client, to: string, body: string, appointmentId: string): Promise<void> {
  // They just texted us — but STOP might have landed in between. Check anyway.
  if (await isOptedOut(to, client.id)) return;
  await notifier.sendSms({ to, body, log: { clientId: client.id, kind: REBOOK_REPLY_KIND, appointmentId } });
}

async function releaseOld(
  client: FullClient,
  appt: Appointment,
  reason: string,
  opts: { calendarHandled?: boolean } = {},
): Promise<Appointment | null> {
  // calendarHandled: the reschedule already moved (or deleted) this
  // appointment's event — deleting by its id now would delete the MOVED event.
  if (appt.externalBookingId && !opts.calendarHandled) {
    try {
      const provider = getBookingProviderForClient(client);
      if (provider.isConfigured()) await provider.cancelBooking(appt.externalBookingId, reason);
    } catch (err) {
      logger.error("rebook.provider_cancel_failed", {
        clientId: client.id,
        appointmentId: appt.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  const cancelled = await cancelAppointment(client.id, appt.id);
  // Waitlist backfill, as the cancel tool does — but only when that time can
  // actually be booked again. A slot inside the owner's own closure isn't an
  // opening; one inside a single team member's leave can still go to someone
  // else on the team.
  if (cancelled) {
    const blocks = await listActiveBlocks(client.id);
    const end = cancelled.endAt ?? new Date(cancelled.startAt.getTime() + 30 * 60_000);
    const verdict = checkSlot({
      hours: client.businessHours,
      blocks: businessWideBlocks(blocks),
      tz: client.timezone,
      startMs: cancelled.startAt.getTime(),
      endMs: end.getTime(),
    });
    if (verdict === "ok" || verdict === "no_hours") {
      await offerFreedSlot(client, {
        startAt: cancelled.startAt,
        endAt: cancelled.endAt,
        serviceId: cancelled.serviceId,
      }).catch((err) =>
        logger.error("rebook.backfill_failed", {
          clientId: client.id,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }
  return cancelled;
}

/**
 * Handle a customer's reply to an open offer. Deterministic: the text is
 * matched, never interpreted, and never passed to a model.
 */
export async function handleRebookReply(
  owner: Client,
  offer: RebookOfferRow,
  body: string,
  now = new Date(),
): Promise<ReplyOutcome> {
  const parsed = parseRebookReply(body, offer.slots.length);
  if (parsed.kind === "unclear") {
    await markOfferReplied(offer.id, now);
    return { handled: false, result: "unclear", alertOwner: true };
  }
  // Claim it. A replayed webhook or a second quick reply loses here.
  if (!(await transitionOffer(offer.id, "sent", { status: "processing", respondedAt: now }))) {
    return { handled: false, result: "already_handled", alertOwner: true };
  }

  const client = await getClientByIdUnsafe(owner.id);
  const appt = await db.query.appointments.findFirst({
    where: and(eq(appointments.id, offer.appointmentId), eq(appointments.clientId, owner.id), isNull(appointments.deletedAt)),
  });
  const to = `+${offer.customerPhone}`;
  if (!client || !appt || (appt.status !== "booked" && appt.status !== "confirmed")) {
    await transitionOffer(offer.id, "processing", { status: "needs_owner", skipReason: "appointment_changed" });
    return { handled: true, result: "appointment_gone", alertOwner: true };
  }

  if (parsed.kind === "decline") {
    await releaseOld(client, appt, "Customer declined new times via text (FrontDesk AI)");
    await transitionOffer(offer.id, "processing", { status: "cancelled" });
    await replyToCustomer(client, to, cancelledText({ businessName: client.name }), appt.id);
    logger.info("rebook.declined", { clientId: client.id, appointmentId: appt.id });
    return { handled: true, result: "cancelled", alertOwner: false };
  }

  const slot = offer.slots[parsed.index];
  const startAt = new Date(slot.startAt);
  const service = client.services.find((s) => s.id === appt.serviceId) ?? null;
  const endAt = new Date(startAt.getTime() + durationOf(appt, service) * 60_000);
  const booked = startAt.getTime() > now.getTime() ? await bookReplacement(client, appt, service, startAt, endAt) : null;
  if (!booked) {
    await transitionOffer(offer.id, "processing", { status: "needs_owner", skipReason: "slot_taken" });
    await replyToCustomer(client, to, slotGoneText({ businessName: client.name }), appt.id);
    return { handled: true, result: "slot_gone", alertOwner: true };
  }

  await releaseOld(client, appt, "Rescheduled by customer via text (FrontDesk AI)", {
    calendarHandled: booked.calendarHandled,
  });
  await transitionOffer(offer.id, "processing", { status: "rescheduled", newAppointmentId: booked.id });
  await replyToCustomer(
    client,
    to,
    rescheduledText({ businessName: client.name, startAt: booked.startAt, tz: client.timezone }),
    booked.id,
  );
  logger.info("rebook.rescheduled", { clientId: client.id, from: appt.id, to: booked.id });
  return { handled: true, result: "rescheduled", alertOwner: false };
}

/**
 * Book the new time with the same sequence as /api/agent-tools/book: every
 * check that can say no, then the real calendar, then the atomic local
 * reserve — and take the calendar event back off if the reserve loses.
 *
 * When the old appointment already has a Google / Outlook event, the event is
 * MOVED instead (same event id, Meet/Teams link and owner notes): reserve the
 * new time locally first, then move the event. A calendar failure there is
 * logged and the booking stands. `calendarHandled` tells the caller the old
 * event has already been moved or deleted.
 */
async function bookReplacement(
  client: FullClient,
  old: Appointment,
  service: Service | null,
  startAt: Date,
  endAt: Date,
): Promise<(Appointment & { calendarHandled: boolean }) | null> {
  const blocks = await listActiveBlocks(client.id);
  const ok = await slotIsBookable(client, service, blocks, startAt, endAt);
  if (!ok.ok) return null;

  let mover: BookingProvider | null = null;
  try {
    const p = getBookingProviderForClient(client);
    if (p.isConfigured() && p.moveBooking && old.externalBookingId) mover = p;
  } catch {
    mover = null;
  }
  if (mover) {
    try {
      if (!(await calendarSlotIsFree(mover, startAt, endAt))) return null;
    } catch (err) {
      logger.error("rebook.provider_busy_check_failed", {
        clientId: client.id,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
    let reserved: Appointment | null = null;
    try {
      reserved = await reserveAppointment(
        client.id,
        {
          callId: old.callId,
          customerName: old.customerName,
          customerPhone: old.customerPhone,
          serviceId: old.serviceId,
          providerId: ok.providerId ?? (client.staffModeEnabled ? null : old.providerId),
          startAt,
          endAt,
          status: "booked",
          externalBookingId: null,
          meetingUrl: null,
        },
        service,
      );
    } catch (err) {
      logger.error("rebook.local_insert_failed", {
        clientId: client.id,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
    if (!reserved) return null;
    const moved = await moveAppointmentEvent(client, old, reserved, {
      virtual: Boolean(service?.virtualOk),
      provider: mover,
    });
    return {
      ...reserved,
      externalBookingId: moved.externalBookingId,
      meetingUrl: moved.meetingUrl,
      calendarHandled: true,
    };
  }

  let externalBookingId: string | null = null;
  let meetingUrl: string | null = null;
  let provider: BookingProvider | null = null;
  try {
    provider = getBookingProviderForClient(client);
    if (provider.isConfigured()) {
      if (!(await calendarSlotIsFree(provider, startAt, endAt))) return null;
      const r = await provider.createBooking({
        startAt: startAt.toISOString(),
        durationMin: Math.round((endAt.getTime() - startAt.getTime()) / 60_000),
        customerName: old.customerName ?? "",
        customerPhone: old.customerPhone ?? "",
        timezone: client.timezone,
        virtual: Boolean(service?.virtualOk),
      });
      externalBookingId = r.externalBookingId;
      meetingUrl = r.meetingUrl ?? null;
    }
  } catch (err) {
    logger.error("rebook.provider_book_failed", {
      clientId: client.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  const release = async () => {
    if (!externalBookingId || !provider) return;
    try {
      await provider.cancelBooking(externalBookingId);
    } catch (err) {
      logger.error("rebook.rollback_failed", {
        clientId: client.id,
        externalBookingId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  try {
    const appt = await reserveAppointment(
      client.id,
      {
        callId: old.callId,
        customerName: old.customerName,
        customerPhone: old.customerPhone,
        serviceId: old.serviceId,
        providerId: ok.providerId ?? (client.staffModeEnabled ? null : old.providerId),
        startAt,
        endAt,
        status: "booked",
        externalBookingId,
        meetingUrl,
      },
      service,
    );
    if (!appt) await release();
    return appt ? { ...appt, calendarHandled: false } : null;
  } catch (err) {
    logger.error("rebook.local_insert_failed", {
      clientId: client.id,
      error: err instanceof Error ? err.message : String(err),
    });
    await release();
    return null;
  }
}
