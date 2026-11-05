import { authorizeAgentTool } from "@/lib/agent-tools-auth";
import { toE164 } from "@/lib/format";
import { getCallByRetellId } from "@/lib/data/calls";
import { createLead } from "@/lib/data/leads";
import { notifyOwnerLead } from "@/lib/notify";
import { leadAlertDeferredToRecap } from "@/lib/call-recap";
import { emitWebhook } from "@/lib/webhooks-emit";
import { after } from "next/server";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const auth = await authorizeAgentTool(req);
  if (!auth.ok) return auth.response;
  const { client, args, retellCallId, channel } = auth;

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

  // An emergency is flagged by the AI (take_message emergency: true) or said
  // in so many words. Either way the owner hears about it NOW, not when the
  // call ends — a burst pipe at 2am can't wait for the recap.
  const emergency = args.emergency === true || String(args.emergency ?? "") === "true";
  const urgencyArg = String(args.urgency ?? "").trim();

  const callRow = retellCallId ? await getCallByRetellId(client.id, retellCallId) : null;
  const lead = await createLead(client.id, {
    callId: callRow?.id ?? null,
    name: String(args.name ?? "").trim() || null,
    phone,
    reason: String(args.reason ?? "").trim() || null,
    message: String(args.message ?? "").trim() || null,
    service: String(args.service ?? "").trim() || null,
    urgency: emergency ? (urgencyArg ? `EMERGENCY — ${urgencyArg}` : "EMERGENCY") : urgencyArg || null,
    budget: String(args.budget ?? "").trim() || null,
    serviceAddress: String(args.service_address ?? "").trim().slice(0, 300) || null,
    status: "new",
  });

  // On a phone call, the alert waits for the call to end: the call recap
  // (lib/call-recap.ts) then sends ONE alert with who called, what they want,
  // urgency and a suggested reply — instead of a bare "New message" now and a
  // second email later. Web chat (no call to recap) still alerts right away.
  // Emergencies skip the wait: alerted immediately (text + email); the recap
  // still follows with the full call summary.
  if (emergency) {
    await notifyOwnerLead(client, lead, { emergency: true });
  } else if (!leadAlertDeferredToRecap({ channel, call: callRow ?? null })) {
    await notifyOwnerLead(client, lead);
  }

  // The caller is still on the line, so this goes after the response. A CRM
  // that is slow, or down, must never become dead air on a phone call.
  after(() =>
    emitWebhook(client.id, "lead.created", {
      leadId: lead.id,
      name: lead.name,
      phone: lead.phone,
      reason: lead.reason,
      message: lead.message,
      service: lead.service,
      urgency: lead.urgency,
      budget: lead.budget,
      serviceAddress: lead.serviceAddress,
      emergency,
      callId: lead.callId,
      createdAt: lead.createdAt.toISOString(),
    }),
  );

  return Response.json({
    success: true,
    message: emergency
      ? "Done — the team has been alerted right now and someone will call you back as soon as possible. If anyone is in danger, hang up and call 911."
      : "Got it — I've passed your message along and someone will follow up shortly.",
  });
}
