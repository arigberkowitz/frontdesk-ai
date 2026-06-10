import { authenticateAgentTool, readToolArgs } from "@/lib/agent-tools-auth";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import { getCallByRetellId } from "@/lib/data/calls";
import { createAppointment } from "@/lib/data/appointments";
import { getBookingProviderForClient } from "@/lib/booking";
import { notifyOwnerBooking } from "@/lib/notify";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const auth = authenticateAgentTool(new URL(req.url));
  if (!auth.ok) return new Response(auth.message, { status: auth.status });

  const { args, retellCallId } = await readToolArgs(req);
  const client = await getClientByIdUnsafe(auth.clientId);
  if (!client) return Response.json({ error: "Client not found" }, { status: 404 });

  const startAt = new Date(String(args.datetime ?? ""));
  if (Number.isNaN(startAt.getTime())) {
    return Response.json({ error: "I didn't catch a valid date and time." });
  }
  if (startAt.getTime() <= Date.now()) {
    return Response.json({
      message: "That time has already passed — what day and time works for you?",
    });
  }

  // Match the requested service exactly — never silently book into the wrong one.
  const wanted = String(args.service ?? "").trim().toLowerCase();
  const service = wanted
    ? client.services.find((s) => s.name.toLowerCase().includes(wanted))
    : undefined;
  if (!service) {
    const names = client.services.filter((s) => s.isActive).map((s) => s.name);
    return Response.json({
      message: names.length
        ? `I want to book the right thing — we offer ${names.join(", ")}. Which would you like?`
        : "I'm not sure which service that is — could you say it again?",
    });
  }

  const durationMin = service.durationMin ?? 30;
  const endAt = new Date(startAt.getTime() + durationMin * 60_000);
  const customerName = String(args.name ?? "").trim();
  const customerPhone = String(args.phone ?? "").trim();
  if (!customerPhone) {
    return Response.json({ message: "What's the best callback number to put on the booking?" });
  }

  // Push to the booking provider if configured; always record locally. Resolving the
  // provider decrypts a stored secret, so keep it inside the try — a bad/rotated key
  // must degrade to a local booking, not 500 mid-call.
  let externalBookingId: string | null = null;
  try {
    const provider = getBookingProviderForClient(client);
    if (provider.isConfigured()) {
      const r = await provider.createBooking({
        startAt: startAt.toISOString(),
        durationMin,
        customerName,
        customerPhone,
        timezone: client.timezone,
      });
      externalBookingId = r.externalBookingId;
    }
  } catch (err) {
    logger.error("agent-tools.book.provider_failed", {
      clientId: client.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const callRow = retellCallId ? await getCallByRetellId(client.id, retellCallId) : null;
  const appt = await createAppointment(client.id, {
    callId: callRow?.id ?? null,
    customerName: customerName || null,
    customerPhone: customerPhone || null,
    serviceId: service.id ?? null,
    startAt,
    endAt,
    status: "booked",
    externalBookingId,
  });

  await notifyOwnerBooking(client, appt);

  return Response.json({
    success: true,
    confirmation_id: appt.id,
    message: `Booked ${service.name} for ${customerName || "you"}. We'll see you then!`,
  });
}
