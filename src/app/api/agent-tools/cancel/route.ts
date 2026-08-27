import { after } from "next/server";
import { authenticateAgentTool, readToolArgs } from "@/lib/agent-tools-auth";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import { getCallByRetellId } from "@/lib/data/calls";
import { cancelAppointment, findUpcomingAppointmentsByPhone } from "@/lib/data/appointments";
import { getBookingProviderForClient } from "@/lib/booking";
import { parseInClientTimezone } from "@/lib/hours-util";
import { notifyOwnerCancellation } from "@/lib/notify";
import { formatDateTime } from "@/lib/format";
import { logger } from "@/lib/logger";
import { offerFreedSlot } from "@/lib/agents/waitlist-backfill";

export const runtime = "nodejs";

/**
 * Agent tool: cancel an existing appointment for a caller. Looks the booking up
 * by the phone number it was made under (defaulting to the caller's number),
 * disambiguates when they have several, and frees the slot. §Same clash model
 * as booking: cancelled appointments stop counting against capacity.
 */
export async function POST(req: Request): Promise<Response> {
  const auth = authenticateAgentTool(new URL(req.url));
  if (!auth.ok) return new Response(auth.message, { status: auth.status });

  const { args, retellCallId } = await readToolArgs(req);
  const client = await getClientByIdUnsafe(auth.clientId);
  if (!client) return Response.json({ error: "Client not found" }, { status: 404 });

  // The number the booking was made under: what the caller gave us, else the
  // number they're calling from.
  let phone = String(args.phone ?? "").trim();
  if (!phone && retellCallId) {
    const callRow = await getCallByRetellId(client.id, retellCallId);
    phone = callRow?.fromNumber ?? "";
  }
  if (!phone) {
    return Response.json({
      message: "What's the phone number the appointment was booked under?",
    });
  }

  const matches = await findUpcomingAppointmentsByPhone(client.id, phone);
  if (matches.length === 0) {
    return Response.json({
      success: false,
      message:
        "I couldn't find an upcoming appointment under that number. Ask if it might be under a different number — otherwise offer to take a message so the team can sort it out.",
    });
  }

  // More than one upcoming appointment: narrow down by the datetime argument,
  // or ask the caller which one they mean.
  let target = matches[0];
  if (matches.length > 1) {
    const wanted = parseInClientTimezone(String(args.datetime ?? ""), client.timezone);
    const hit = wanted
      ? matches.find((a) => Math.abs(a.startAt.getTime() - wanted.getTime()) < 60 * 60_000)
      : undefined;
    if (!hit) {
      const options = matches
        .slice(0, 4)
        .map(
          (a) =>
            `${a.service?.name ?? "appointment"} on ${formatDateTime(a.startAt, client.timezone)}`,
        )
        .join("; ");
      return Response.json({
        message: `They have more than one upcoming appointment: ${options}. Ask which one to cancel, then call this tool again with that appointment's date and time.`,
      });
    }
    target = hit;
  }

  // Best-effort cancel on the external calendar; the local record is the source
  // of truth for slot capacity, so never let a provider hiccup block the caller.
  if (target.externalBookingId) {
    try {
      const provider = getBookingProviderForClient(client);
      if (provider.isConfigured()) {
        await provider.cancelBooking(target.externalBookingId, "Cancelled by caller via FrontDesk AI");
      }
    } catch (err) {
      logger.error("agent-tools.cancel.provider_failed", {
        clientId: client.id,
        appointmentId: target.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const cancelled = await cancelAppointment(client.id, target.id);
  if (cancelled) {
    // The slot is perishable. Tell the people who wanted it — after the
    // response, because the caller who just cancelled is still on the line.
    after(() =>
      offerFreedSlot(client, {
        startAt: cancelled.startAt,
        endAt: cancelled.endAt,
        serviceId: cancelled.serviceId,
      }),
    );
  }
  if (!cancelled) {
    return Response.json({
      success: false,
      message: "Something went wrong cancelling that. Offer to take a message so the team can handle it.",
    });
  }

  await notifyOwnerCancellation(client, cancelled, "phone");

  const when = formatDateTime(cancelled.startAt, client.timezone);
  return Response.json({
    success: true,
    message: `Cancelled: ${target.service?.name ?? "the appointment"} on ${when}. Confirm it's cancelled, and offer to rebook them for another time.`,
  });
}
