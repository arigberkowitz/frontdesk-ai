import { getCurrentDbUserSafe, userMayAccessClient } from "@/lib/auth-guard";
import { getClient } from "@/lib/data/clients";
import { getRetellClient } from "@/lib/retell";
import { logger } from "@/lib/logger";

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
  // This checked only `client_viewer`, which let any client_admin — the role
  // every self-serve signup gets — start a web call against ANOTHER business's
  // agent: their prompt, prices, FAQs, and live booking tools. The org lookup
  // below is no defence, because every self-serve business shares one org.
  if (!userMayAccessClient(user, id)) {
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
    // The vendor's message can name the account and the agent, so it stays in
    // the log rather than going back to a browser.
    logger.error("test-call.failed", {
      clientId: id,
      error: err instanceof Error ? err.message : String(err),
    });
    return Response.json(
      { error: "Couldn't start the test call just now. Try again in a moment." },
      { status: 500 },
    );
  }
}
