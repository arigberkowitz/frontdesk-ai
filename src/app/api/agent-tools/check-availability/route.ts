import { authenticateAgentTool, readToolArgs } from "@/lib/agent-tools-auth";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import { listActiveBlocks } from "@/lib/data/availability-blocks";
import { getBookingProviderForClient } from "@/lib/booking";
import { logger } from "@/lib/logger";

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
  const auth = authenticateAgentTool(new URL(req.url));
  if (!auth.ok) return new Response(auth.message, { status: auth.status });

  const { args } = await readToolArgs(req);
  const client = await getClientByIdUnsafe(auth.clientId);
  if (!client) return Response.json({ error: "Client not found" }, { status: 404 });

  const wanted = String(args.service ?? "").toLowerCase();
  const service =
    client.services.find((s) => s.name.toLowerCase().includes(wanted)) ?? client.services[0];
  const durationMin = service?.durationMin ?? 30;

  const now = new Date();
  const rangeEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
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

    const blocks = await listActiveBlocks(client.id);
    const slots = await provider.getAvailability({
      durationMin,
      rangeStart: now.toISOString(),
      rangeEnd: rangeEnd.toISOString(),
      timezone: client.timezone,
      businessHours: client.businessHours,
      blocks,
    });

    if (slots.length === 0) {
      return Response.json({
        status: "all_booked",
        available_slots: [],
        say: "There are genuinely no open times in the next 7 days. Say you don't have anything free this week, then take their details so the team can offer the first opening.",
      });
    }

    return Response.json({
      status: "ok",
      service: service?.name,
      available_slots: slots.slice(0, 8).map((s) => s.startAt),
      say: "Offer only these times. Never invent a time that is not in this list.",
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
