import { authenticateAgentTool } from "@/lib/agent-tools-auth";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import { isAfterHours } from "@/lib/hours-util";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * The escalation target, or a refusal.
 *
 * The owner's handoff setting is enforced HERE as well as in the prompt,
 * because a prompt is a request and this is a decision. "Only during opening
 * hours" has to mean it, not mostly mean it — the whole point of the setting is
 * that nobody's phone rings at eleven at night.
 */
export async function POST(req: Request): Promise<Response> {
  const auth = authenticateAgentTool(new URL(req.url));
  if (!auth.ok) return new Response(auth.message, { status: auth.status });

  const client = await getClientByIdUnsafe(auth.clientId);
  if (!client) return Response.json({ error: "Client not found" }, { status: 404 });

  const mode = client.setupFlags?.handoffMode ?? "always";
  const takeMessage = (reason: string) => {
    logger.info("agent-tools.transfer.declined", { clientId: client.id, reason });
    return Response.json({
      transfer: false,
      message:
        reason === "closed"
          ? "The team's out of hours right now, so I can't put you through — but I can take a message and have someone call you first thing. Can I get your name and the best number?"
          : "I'm not able to put you through, but I'd be glad to take a message and have someone call you right back.",
    });
  };

  if (mode === "never") return takeMessage("handoff_off");

  if (mode === "open_hours" && isAfterHours(new Date(), client.timezone, client.businessHours)) {
    return takeMessage("closed");
  }

  const to = client.escalationNumber?.trim();
  if (!to) return takeMessage("no_number");

  return Response.json({ transfer_to: to, message: "One moment while I connect you to someone." });
}
