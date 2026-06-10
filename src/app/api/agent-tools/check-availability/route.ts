import { authenticateAgentTool, readToolArgs } from "@/lib/agent-tools-auth";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import { getBookingProviderForClient } from "@/lib/booking";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

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
        message: "Booking isn't connected yet — offer to take a message instead.",
      });
    }
    const slots = await provider.getAvailability({
      durationMin,
      rangeStart: now.toISOString(),
      rangeEnd: rangeEnd.toISOString(),
      timezone: client.timezone,
      businessHours: client.businessHours,
    });
    return Response.json({
      service: service?.name,
      available_slots: slots.slice(0, 8).map((s) => s.startAt),
    });
  } catch (err) {
    logger.error("agent-tools.availability.failed", {
      clientId: client.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return Response.json({ message: "I couldn't reach the calendar right now." });
  }
}
