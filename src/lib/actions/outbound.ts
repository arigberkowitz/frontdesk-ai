"use server";

import { revalidatePath } from "next/cache";
import { requireClientEditor } from "@/lib/auth-guard";
import { assertClientInOrg, getClientByIdUnsafe } from "@/lib/data/clients";
import { getClientLead } from "@/lib/data/leads";
import { createReminder } from "@/lib/data/reminders";
import { getRetellClient } from "@/lib/retell";
import { withinTextingHours } from "@/lib/appointment-messages";
import { integrations } from "@/lib/env";
import { toE164, formatPhone } from "@/lib/format";
import { logger } from "@/lib/logger";
import { type ActionState } from "./types";

/**
 * Have the AI ring a lead back.
 *
 * The only "Call" this product had opened the operating system's phone handler
 * — which on a laptop is a dialog asking to launch an app that mostly isn't
 * there, and which never placed a call under any circumstances. It was a
 * gesture at calling, not calling.
 *
 * This actually dials, from the business's own number, using the agent the
 * business already trained. The call is logged against the lead so the portal
 * stops claiming nobody has been in touch.
 */
export async function callLeadWithAiAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const leadId = String(formData.get("leadId") ?? "");

  const guard = await requireClientEditor(clientId);
  if (!guard.ok) return { ok: false, error: guard.error };
  await assertClientInOrg(guard.user.orgId, clientId);

  if (!integrations.retell()) {
    return { ok: false, error: "Calling isn't connected yet." };
  }

  const lead = await getClientLead(clientId, leadId);
  if (!lead) return { ok: false, error: "Lead not found." };

  const to = toE164(lead.phone ?? "");
  if (!to) {
    return { ok: false, error: "There's no number on this lead we can dial." };
  }

  const client = await getClientByIdUnsafe(clientId);
  if (!client) return { ok: false, error: "Business not found." };

  // Your AI calls from your number, so their phone shows the business they
  // rang — and a callback to it reaches the receptionist rather than nothing.
  const from = toE164(client.retellPhoneNumber ?? "");
  if (!from) {
    return {
      ok: false,
      error: "Your AI doesn't have a phone number yet, so it can't place calls. Activate it first.",
    };
  }

  // A robot ringing someone at 6am on the business's behalf is worse than not
  // ringing them at all. Same civilized window the texts use.
  if (!withinTextingHours(new Date(), client.timezone)) {
    return {
      ok: false,
      error: "It's outside calling hours where you are (9am–8pm). Try again in the morning.",
    };
  }

  try {
    const call = await getRetellClient().call.createPhoneCall({
      from_number: from,
      to_number: to,
      // Read back by the post-call pipeline; also how this call is told apart
      // from one the customer placed.
      metadata: { clientId, leadId, direction: "outbound", placedBy: guard.user.id },
    });
    logger.info("outbound.lead_call.placed", { clientId, leadId, callId: call.call_id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("outbound.lead_call.failed", { clientId, leadId, error: message });
    return {
      ok: false,
      error: "Couldn't place the call. Your AI's number may not be able to dial out yet.",
    };
  }

  // Logged as contact, because it is: their phone is ringing right now.
  await createReminder(clientId, {
    leadId,
    channel: "call",
    status: "sent",
    sentAt: new Date(),
    error: null,
  });
  revalidatePath("/portal/leads");

  return { ok: true, message: `Calling ${formatPhone(to)} now — it'll ring in a few seconds.` };
}
