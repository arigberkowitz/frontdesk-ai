import { authenticateAgentTool, readToolArgs } from "@/lib/agent-tools-auth";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import { toE164 } from "@/lib/format";
import { getCallByRetellId } from "@/lib/data/calls";
import { createLead } from "@/lib/data/leads";
import { notifyOwnerLead } from "@/lib/notify";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const auth = authenticateAgentTool(new URL(req.url));
  if (!auth.ok) return new Response(auth.message, { status: auth.status });

  const { args, retellCallId } = await readToolArgs(req);
  const client = await getClientByIdUnsafe(auth.clientId);
  if (!client) return Response.json({ error: "Client not found" }, { status: 404 });

  // Normalize the number the moment it arrives. A message whose phone field
  // holds "four one five..." or a half-heard string is a lead the business
  // cannot chase, and it looks identical to a good one in the list.
  const spokenPhone = String(args.phone ?? "").trim();
  const phone = toE164(spokenPhone);
  if (spokenPhone && !phone) {
    return Response.json({
      message:
        "I want to make sure they can reach you — could you read me the number one digit at a time?",
    });
  }

  const callRow = retellCallId ? await getCallByRetellId(client.id, retellCallId) : null;
  const lead = await createLead(client.id, {
    callId: callRow?.id ?? null,
    name: String(args.name ?? "").trim() || null,
    phone,
    reason: String(args.reason ?? "").trim() || null,
    message: String(args.message ?? "").trim() || null,
    service: String(args.service ?? "").trim() || null,
    urgency: String(args.urgency ?? "").trim() || null,
    budget: String(args.budget ?? "").trim() || null,
    status: "new",
  });

  await notifyOwnerLead(client, lead);

  return Response.json({
    success: true,
    message: "Got it — I've passed your message along and someone will follow up shortly.",
  });
}
