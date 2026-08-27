import { after } from "next/server";
import { authenticateAgentTool, readToolArgs } from "@/lib/agent-tools-auth";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import { getCallByRetellId } from "@/lib/data/calls";
import { addWaitlistEntry } from "@/lib/data/waitlist";
import { matchService } from "@/lib/service-match";
import { listServices } from "@/lib/data/services";
import { toE164 } from "@/lib/format";
import { emitWebhook } from "@/lib/webhooks-emit";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

/** How far out a "let me know" is worth keeping, when the caller gives no end. */
const DEFAULT_WINDOW_DAYS = 30;

/**
 * Agent tool: put this caller on the waitlist.
 *
 * The AI reaches here when it couldn't offer the caller a time they wanted.
 * Before this existed, that caller became a lead or nothing, and the Thursday
 * slot somebody cancelled on Wednesday went to no one.
 *
 * The window is a range because "sometime next week" and "Thursday afternoon"
 * are both real answers. A waitlist that only stores exact times matches almost
 * nothing, which is the same as not having one.
 */
export async function POST(req: Request): Promise<Response> {
  const auth = authenticateAgentTool(new URL(req.url));
  if (!auth.ok) return new Response(auth.message, { status: auth.status });

  const { args, retellCallId } = await readToolArgs(req);
  const client = await getClientByIdUnsafe(auth.clientId);
  if (!client) return new Response("Not found", { status: 404 });

  if (!client.waitlistEnabled) {
    return Response.json({
      success: false,
      message:
        "We don't keep a waitlist. Offer to take a message instead so someone can call them back.",
    });
  }

  const phone = toE164(String(args.phone ?? "")) ?? "";
  if (!phone) {
    return Response.json({
      success: false,
      message:
        "I want to make sure we can reach you — could you read me the number one digit at a time?",
    });
  }

  const now = new Date();
  const parseAt = (v: unknown): Date | null => {
    const raw = String(v ?? "").trim();
    if (!raw) return null;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  // A missing start means "as soon as anything opens", which is now. A missing
  // end means "keep me in mind", which we cap rather than leaving open forever
  // — an entry with no end date is a text arriving in nine months.
  const earliestAt = parseAt(args.earliest_datetime) ?? now;
  const latestAt =
    parseAt(args.latest_datetime) ??
    new Date(earliestAt.getTime() + DEFAULT_WINDOW_DAYS * 86_400_000);

  if (latestAt.getTime() <= earliestAt.getTime()) {
    return Response.json({
      success: false,
      message: "I didn't catch the dates — could you tell me the range of times that would work?",
    });
  }

  const services = await listServices(client.id);
  const matched = matchService(String(args.service ?? ""), services);
  const serviceId = matched.kind === "exact" ? matched.service.id : null;

  const callRow = retellCallId ? await getCallByRetellId(client.id, retellCallId) : null;
  const entry = await addWaitlistEntry(client.id, {
    callId: callRow?.id ?? null,
    serviceId,
    customerName: String(args.name ?? "").trim() || null,
    customerPhone: phone,
    earliestAt,
    latestAt,
    note: String(args.note ?? "").trim() || null,
    status: "waiting",
  });

  logger.info("agent-tools.waitlist.added", { clientId: client.id, entryId: entry.id });

  after(() =>
    emitWebhook(client.id, "lead.created", {
      source: "waitlist",
      waitlistEntryId: entry.id,
      name: entry.customerName,
      phone: entry.customerPhone,
      service: matched.kind === "exact" ? matched.service.name : null,
      earliestAt: entry.earliestAt.toISOString(),
      latestAt: entry.latestAt.toISOString(),
      note: entry.note,
      callId: entry.callId,
    }),
  );

  return Response.json({
    success: true,
    message:
      "You're on the list — if anything opens up in that window we'll text you right away. First to reply gets it.",
  });
}
