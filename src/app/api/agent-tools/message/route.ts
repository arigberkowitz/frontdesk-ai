import { authenticateAgentTool, readToolArgs } from "@/lib/agent-tools-auth";
import { getClientByIdUnsafe } from "@/lib/data/clients";
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

  const callRow = retellCallId ? await getCallByRetellId(client.id, retellCallId) : null;
  const lead = await createLead(client.id, {
    callId: callRow?.id ?? null,
    name: String(args.name ?? "").trim() || null,
    phone: String(args.phone ?? "").trim() || null,
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
