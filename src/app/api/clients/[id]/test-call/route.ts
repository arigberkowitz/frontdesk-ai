import { getCurrentDbUserSafe, userMayAccessClient } from "@/lib/auth-guard";
import { getClient } from "@/lib/data/clients";
import { createWebCall } from "@/lib/retell";
import { logger } from "@/lib/logger";
import { WAF_RATE_LIMIT_IDS, wafRateLimited } from "@/lib/waf-rate-limit";

export const runtime = "nodejs";

/**
 * Create a Retell web call against the client's provisioned agent (§B6 test call).
 * Returns an access token the browser SDK uses to connect — no phone number needed.
 */
export async function POST(
  req: Request,
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
    return Response.json({ error: "Your receptionist isn't set up yet." }, { status: 400 });
  }

  if (
    await wafRateLimited(WAF_RATE_LIMIT_IDS.testCall, {
      request: req,
      rateLimitKey: `test-call:${user.id}:${id}`,
    })
  ) {
    return Response.json(
      { error: "That's a few test calls in a row — try again in a few minutes." },
      { status: 429 },
    );
  }

  try {
    const webCall = await createWebCall(client.retellAgentId);
    // Forward v3 connection details to the browser SDK. Do not log them —
    // accessToken and iceServers are short-lived call credentials.
    return Response.json({
      accessToken: webCall.accessToken,
      callId: webCall.callId,
      transport: webCall.transport,
      iceServers: webCall.iceServers,
    });
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
