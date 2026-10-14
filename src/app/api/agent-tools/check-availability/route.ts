import { authorizeAgentTool } from "@/lib/agent-tools-auth";
import { listActiveBlocks } from "@/lib/data/availability-blocks";
import { businessWideBlocks } from "@/lib/booking-window";
import { matchService } from "@/lib/service-match";
import { getBookingProviderForClient } from "@/lib/booking";
import { logger } from "@/lib/logger";
import { localSlot } from "@/lib/slot-label";
import { resolveDateRange } from "@/lib/date-range";

export const runtime = "nodejs";

/**
 * Availability for the live agent.
 *
 * Every response carries an explicit `status` and a `say` instruction, never a
 * bare empty list. An empty list is ambiguous — "booked solid" and "this
 * business never set opening hours" look identical — and the agent resolved
 * that ambiguity by telling callers a wide-open week was fully booked. Now the
 * tool states which situation it is and what to do about it.
 */
export async function POST(req: Request): Promise<Response> {
  const auth = await authorizeAgentTool(req);
  if (!auth.ok) return auth.response;
  const { client, args } = auth;

  // Only the length matters here — we're sizing the slot grid, not booking.
  // Falling back to `services[0]` used to reach retired services and size the
  // grid off something the business no longer offers.
  const match = matchService(String(args.service ?? ""), client.services);
  const active = client.services.filter((s) => s.isActive !== false);
  const service = match.kind === "exact" ? match.service : active[0];
  const durationMin = service?.durationMin ?? 30;

  // Honour the requested day/range in the business's own calendar. Ignoring it
  // meant "Thursday" late on Tuesday only ever saw Wednesday's first slots.
  const range = resolveDateRange(args.date_range, client.timezone);
  try {
    // Resolving the provider decrypts a stored secret — keep it inside the try so a
    // bad/rotated key degrades to "take a message" instead of 500-ing mid-call.
    const provider = getBookingProviderForClient(client);
    if (!provider.isConfigured()) {
      return Response.json({
        status: "no_calendar",
        available_slots: [],
        say: "You cannot see the calendar. Do NOT say they are fully booked. Take a message with their name, number and preferred times, and tell them someone will call back to confirm.",
      });
    }

    const openDays = client.businessHours.filter(
      (h) => !h.isClosed && h.openTime && h.closeTime,
    ).length;
    if (openDays === 0) {
      // Hours were never set. Slots would come back empty for a reason that has
      // nothing to do with how busy they are — never let that read as booked.
      logger.warn("agent-tools.availability.no_hours", { clientId: client.id });
      return Response.json({
        status: "no_hours",
        available_slots: [],
        say: "Opening hours are not set up, so you cannot check times. Do NOT say they are fully booked. Take a message with their name, number and preferred times, and tell them someone will call back to confirm.",
      });
    }

    // Only closures that apply to the whole business. A block tied to one
    // person is their leave; treating it as a shutdown made a single hygienist's
    // Friday off read as "we're fully booked all Friday".
    const blocks = businessWideBlocks(await listActiveBlocks(client.id));
    const slots = await provider.getAvailability({
      durationMin,
      rangeStart: range.start.toISOString(),
      rangeEnd: range.end.toISOString(),
      timezone: client.timezone,
      businessHours: client.businessHours,
      blocks,
    });

    if (slots.length === 0) {
      return Response.json({
        status: "all_booked",
        available_slots: [],
        say: range.matched
          ? "There are no open times on the day(s) they asked for. Say so, and offer to check another day (call check_availability again with that day)."
          : "There are genuinely no open times in the next 7 days. Say you don't have anything free this week, then take their details so the team can offer the first opening.",
      });
    }

    return Response.json({
      status: "ok",
      service: service?.name,
      timezone: client.timezone,
      available_slots: slots.slice(0, 8).map((s) => localSlot(s.startAt, client.timezone)),
      say: `Offer only these times, using each slot's label (already in ${client.timezone}). Never invent a time that is not in this list. When booking, pass the slot's start exactly.`,
    });
  } catch (err) {
    logger.error("agent-tools.availability.failed", {
      clientId: client.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return Response.json({
      status: "error",
      available_slots: [],
      say: "The calendar could not be reached. Do NOT say they are fully booked. Take a message and tell them someone will call back to confirm the time.",
    });
  }
}
