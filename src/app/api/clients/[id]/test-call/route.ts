import { getCurrentDbUserSafe } from "@/lib/auth-guard";
import { getClient } from "@/lib/data/clients";
import { getRetellClient } from "@/lib/retell";

export const runtime = "nodejs";

/**
 * Create a Retell web call against the client's provisioned agent (§B6 test call).
 * Returns an access token the browser SDK uses to connect — no phone number needed.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  const user = await getCurrentDbUserSafe();
  if (!user) return new Response("Unauthorized", { status: 401 });
  // Operators may test any client in their org; a client viewer only their own.
  if (user.role === "client_viewer" && user.clientId !== id) {
    return new Response("Forbidden", { status: 403 });
  }

  const client = await getClient(user.orgId, id);
  if (!client) return new Response("Not found", { status: 404 });
  if (!client.retellAgentId) {
    return Response.json({ error: "Provision the agent first." }, { status: 400 });
  }

  try {
    const webCall = await getRetellClient().call.createWebCall({
      agent_id: client.retellAgentId,
    });
    return Response.json({ accessToken: webCall.access_token, callId: webCall.call_id });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to start the test call." },
      { status: 500 },
    );
  }
}
