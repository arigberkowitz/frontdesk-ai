import { authenticateAgentTool, readToolArgs } from "@/lib/agent-tools-auth";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import { getCallByRetellId } from "@/lib/data/calls";
import { hasOverlappingAppointment, reserveAppointment } from "@/lib/data/appointments";
import { findFreeProvider } from "@/lib/data/providers";
import { listActiveBlocks } from "@/lib/data/availability-blocks";
import { getBookingProviderForClient } from "@/lib/booking";
import { blocksForProvider, businessWideBlocks, checkSlot, slotRefusal } from "@/lib/booking-window";
import { matchService, serviceClarification } from "@/lib/service-match";
import { parseInClientTimezone } from "@/lib/hours-util";
import { toE164 } from "@/lib/format";
import { notifyOwnerBooking } from "@/lib/notify";
import { sendBookingConfirmation } from "@/lib/appointment-texts";
import { recordSmsConsent } from "@/lib/data/sms-consents";
import { after } from "next/server";
import { logger } from "@/lib/logger";
import { emitWebhook } from "@/lib/webhooks-emit";

/**
 * Take a calendar event back off when the booking behind it never happened.
 * An orphaned event is a phantom appointment: the business will honour it and
 * we have no record of who it's for.
 */
async function releaseExternalBooking(
  client: Parameters<typeof getBookingProviderForClient>[0],
  externalBookingId: string | null,
): Promise<void> {
  if (!externalBookingId) return;
  try {
    await getBookingProviderForClient(client).cancelBooking(externalBookingId);
  } catch (err) {
    logger.error("agent-tools.book.rollback_failed", {
      clientId: client.id,
      externalBookingId,
      error: err instanceof Error ? err.message : String(err),
      detail: "A calendar event exists with no appointment behind it — needs manual removal.",
    });
  }
}

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const auth = authenticateAgentTool(new URL(req.url));
  if (!auth.ok) return new Response(auth.message, { status: auth.status });

  const { args, retellCallId } = await readToolArgs(req);
  const client = await getClientByIdUnsafe(auth.clientId);
  if (!client) return Response.json({ error: "Client not found" }, { status: 404 });

  const startAt = parseInClientTimezone(String(args.datetime ?? ""), client.timezone);
  if (!startAt) {
    return Response.json({ error: "I didn't catch a valid date and time." });
  }
  if (startAt.getTime() <= Date.now()) {
    return Response.json({
      message: "That time has already passed — what day and time works for you?",
    });
  }

  const match = matchService(String(args.service ?? ""), client.services);
  if (match.kind !== "exact") {
    return Response.json({ message: serviceClarification(match) });
  }
  const service = match.service;

  const durationMin = service.durationMin ?? 30;
  const endAt = new Date(startAt.getTime() + durationMin * 60_000);
  const customerName = String(args.name ?? "").trim();
  // A booking with an unusable number is a booking nobody can confirm, move, or
  // chase — and "ended with no way to call back" is one of the failures we
  // report to the business. Better to ask again on the call than to write a
  // record that quietly can't be acted on.
  const spokenPhone = String(args.phone ?? "").trim();
  if (!spokenPhone) {
    return Response.json({ message: "What's the best callback number to put on the booking?" });
  }
  const customerPhone = toE164(spokenPhone);
  if (!customerPhone) {
    logger.info("agent-tools.book.unusable_phone", { clientId: client.id });
    return Response.json({
      message:
        "I didn't quite catch that number. Could you read me the ten digits one at a time?",
    });
  }

  // ---------------------------------------------------------------------
  // Everything that can say no comes BEFORE anything that writes.
  //
  // This used to create the Google event first and check for a double-booking
  // second, so a clash left a real event on a real calendar with no appointment
  // behind it and nobody to clean it up. Check first, write last, and undo the
  // calendar event if the local insert falls over.
  // ---------------------------------------------------------------------

  const blocks = await listActiveBlocks(client.id);

  // A caller can name any time they like. Google's free/busy says nothing about
  // whether the business is even open — an empty calendar at 3 AM looks free —
  // so the hours and the owner's blocked-out windows are checked here.
  const verdict = checkSlot({
    hours: client.businessHours,
    blocks: businessWideBlocks(blocks),
    tz: client.timezone,
    startMs: startAt.getTime(),
    endMs: endAt.getTime(),
  });
  if (verdict === "closed" || verdict === "blocked") {
    return Response.json({ success: false, error: slotRefusal(verdict) });
  }

  // Double-booking guard. Staff mode: assign a free team member (honoring a
  // requested person); each person holds one appointment at a time. Otherwise:
  // capacity-aware per service (N providers = N overlapping slots; default 1).
  let providerId: string | null = null;
  let providerName: string | null = null;
  if (client.staffModeEnabled) {
    const preferred = String(args.person ?? "").trim() || null;
    const free = await findFreeProvider(client.id, startAt, endAt, preferred, {
      blocks,
      timezone: client.timezone,
    });
    if (!free) {
      return Response.json({
        success: false,
        error: preferred
          ? `${preferred} isn't available at that time. Offer a different time, or ask if someone else on the team is okay.`
          : "The whole team is booked at that time. Apologize briefly and offer a different time.",
      });
    }
    providerId = free.id;
    providerName = free.name;
  } else if (await hasOverlappingAppointment(client.id, startAt, endAt, service)) {
    return Response.json({
      success: false,
      error:
        "That time slot is already booked. Apologize briefly and offer the caller a different time.",
    });
  }

  // Sanity check on the assignment: a person on leave is not available, even if
  // their appointment book happens to be empty that afternoon.
  if (providerId && blocks.length) {
    const personBusy = checkSlot({
      hours: client.businessHours,
      blocks: blocksForProvider(blocks, providerId),
      tz: client.timezone,
      startMs: startAt.getTime(),
      endMs: endAt.getTime(),
    });
    if (personBusy === "blocked") {
      return Response.json({
        success: false,
        error: "That person is away at that time. Offer a different time or another team member.",
      });
    }
  }

  // Push to the booking provider if configured; always record locally. Resolving the
  // provider decrypts a stored secret, so keep it inside the try — a bad/rotated key
  // must degrade to a local booking, not 500 mid-call.
  let externalBookingId: string | null = null;
  let meetingUrl: string | null = null;
  try {
    const provider = getBookingProviderForClient(client);
    if (provider.isConfigured()) {
      const r = await provider.createBooking({
        startAt: startAt.toISOString(),
        durationMin,
        customerName,
        customerPhone,
        timezone: client.timezone,
        // Video-friendly service → the calendar event gets a Meet/Teams link.
        virtual: Boolean(service.virtualOk),
      });
      externalBookingId = r.externalBookingId;
      meetingUrl = r.meetingUrl ?? null;
    }
  } catch (err) {
    logger.error("agent-tools.book.provider_failed", {
      clientId: client.id,
      error: err instanceof Error ? err.message : String(err),
    });
    // The real calendar refused (slot taken, outside hours, auth issue). Never
    // tell the caller "booked" when nothing landed on the actual calendar.
    return Response.json({
      success: false,
      error:
        "That time isn't available on the calendar after all. Apologize and offer the caller a different time.",
    });
  }

  const callRow = retellCallId ? await getCallByRetellId(client.id, retellCallId) : null;
  // Re-checked and inserted atomically: the pre-flight check above is for
  // giving the caller a fast, kind answer; this is the one that's actually
  // binding. Between them sits every other caller on the line right now.
  let appt;
  try {
    appt = await reserveAppointment(
      client.id,
      {
        callId: callRow?.id ?? null,
        customerName: customerName || null,
        customerPhone: customerPhone || null,
        serviceId: service.id ?? null,
        providerId,
        startAt,
        endAt,
        status: "booked",
        externalBookingId,
        meetingUrl,
      },
      service,
    );
  } catch (err) {
    // The event is already on their calendar and we have nothing to attach it
    // to. Take it back off — an orphan event is a phantom appointment that the
    // business will honour and we have no record of.
    logger.error("agent-tools.book.local_insert_failed", {
      clientId: client.id,
      externalBookingId,
      error: err instanceof Error ? err.message : String(err),
    });
    await releaseExternalBooking(client, externalBookingId);
    return Response.json({
      success: false,
      error:
        "Something went wrong saving that booking. Apologize, take their name and number, and say the team will call to confirm.",
    });
  }

  if (!appt) {
    // Someone else took it in the seconds we spent talking to the calendar.
    logger.info("agent-tools.book.lost_race", { clientId: client.id, startAt: startAt.toISOString() });
    await releaseExternalBooking(client, externalBookingId);
    return Response.json({
      success: false,
      error:
        "That time was just taken by someone else. Apologize briefly and offer the caller a different time.",
    });
  }

  await notifyOwnerBooking(client, appt);

  after(() =>
    emitWebhook(client.id, "appointment.booked", {
      appointmentId: appt.id,
      customerName: appt.customerName,
      customerPhone: appt.customerPhone,
      service: service.name,
      startAt: appt.startAt.toISOString(),
      endAt: appt.endAt?.toISOString() ?? null,
      status: appt.status,
      source: "ai_call",
      callId: callRow?.id ?? null,
    }),
  );

  // The confirmation text the caller was asked about, and agreed to, moments
  // ago. Until now the agent asked, they said yes, and nothing was ever sent.
  // Sent inline so it lands while they're still holding the phone.
  const consented = args.sms_consent === true || String(args.sms_consent) === "true";
  if (consented) {
    // The receipt the privacy policy promises: who said yes, when, on which
    // call, to which version of the ask. Until now the yes lived for
    // milliseconds as a tool argument and vanished — the one fact a business
    // needs if a text is ever disputed, and we were throwing it away.
    after(() =>
      recordSmsConsent({ clientId: client.id, phone: customerPhone, callId: callRow?.id }),
    );
    after(() =>
      sendBookingConfirmation(client, appt, service.name).catch((err) =>
        logger.error("agent-tools.book.confirmation_failed", {
          clientId: client.id,
          appointmentId: appt.id,
          error: err instanceof Error ? err.message : String(err),
        }),
      ),
    );
  } else {
    logger.info("agent-tools.book.no_sms_consent", { clientId: client.id, appointmentId: appt.id });
  }

  return Response.json({
    success: true,
    confirmation_id: appt.id,
    message: `Booked ${service.name}${providerName ? ` with ${providerName}` : ""} for ${customerName || "you"}. We'll see you then!`,
  });
}
