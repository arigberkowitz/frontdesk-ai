import { authenticateAgentTool } from "@/lib/agent-tools-auth";
import { getClientByIdUnsafe } from "@/lib/data/clients";

export const runtime = "nodejs";

/**
 * Returns the escalation target for the agent to transfer to. NOTE: for a true
 * warm transfer, this should be upgraded to Retell's native `transfer_call`
 * tool — see DECISIONS.md. v1 returns the number + a hand-off line.
 */
export async function POST(req: Request): Promise<Response> {
  const auth = authenticateAgentTool(new URL(req.url));
  if (!auth.ok) return new Response(auth.message, { status: auth.status });

  const client = await getClientByIdUnsafe(auth.clientId);
  if (!client) return Response.json({ error: "Client not found" }, { status: 404 });

  const to = client.escalationNumber?.trim();
  if (!to) {
    return Response.json({
      message: "I'm not able to transfer right now, but I'd be glad to take a message.",
    });
  }
  return Response.json({ transfer_to: to, message: "One moment while I connect you to someone." });
}
