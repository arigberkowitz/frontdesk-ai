"use server";

import { revalidatePath } from "next/cache";
import { assertClientAccess } from "@/lib/auth-guard";
import { assertClientInOrg, getClientByIdUnsafe } from "@/lib/data/clients";
import { createReminder, getClientAppointment } from "@/lib/data/reminders";
import { getClientLead } from "@/lib/data/leads";
import { getInsightForCall } from "@/lib/data/insights";
import { isOptedOut } from "@/lib/data/sms-optouts";
import { explainSmsError, notifier } from "@/lib/notifier";
import { integrations } from "@/lib/env";
import { formatDateTime } from "@/lib/format";
import { logger } from "@/lib/logger";
import { type ActionState } from "./types";

/**
 * Send (or, in demo mode, simulate) an appointment reminder to a customer by text
 * or call, and log it so the portal shows exactly when each customer was pinged.
 * Text goes out for real through Twilio when it's connected; until telephony is
 * set up the reminder is recorded as a demo send so the feature is fully usable.
 */
export async function sendReminderAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const appointmentId = String(formData.get("appointmentId") ?? "");
  const channel = String(formData.get("channel") ?? "") === "call" ? "call" : "sms";

  const user = await assertClientAccess(clientId);
  await assertClientInOrg(user.orgId, clientId);

  const appt = await getClientAppointment(clientId, appointmentId);
  if (!appt) return { ok: false, error: "Appointment not found." };
  if (appt.status === "cancelled" || appt.status === "no_show") {
    return { ok: false, error: "This appointment was cancelled — no reminder to send." };
  }

  const phone = appt.customerPhone?.trim();
  if (!phone) {
    return { ok: false, error: "No phone number on file for this customer — add one to send a reminder." };
  }
  if (channel === "sms" && (await isOptedOut(phone))) {
    return { ok: false, error: "This number has opted out of texts (replied STOP) — call them instead." };
  }

  const client = await getClientByIdUnsafe(clientId);
  const business = client?.name ?? "your appointment";
  const when = formatDateTime(appt.startAt, client?.timezone ?? undefined);
  const service = appt.service?.name ? `${appt.service.name} ` : "";
  const callbackNumber = client?.escalationNumber?.trim();
  const body =
    `Hi${appt.customerName ? ` ${appt.customerName}` : ""}, a friendly reminder of your ${service}appointment with ${business} on ${when}.` +
    (appt.meetingUrl ? ` Join by video: ${appt.meetingUrl}` : "") +
    (callbackNumber ? ` Need to reschedule? Call ${callbackNumber}.` : "");

  // Outbound voice isn't wired up. This used to write a "sent" row anyway and
  // tell the owner the reminder went out, so the appointment history showed a
  // call that never happened — the one record they'd rely on if a customer
  // said nobody told them.
  if (channel === "call") {
    return {
      ok: false,
      error: "Calling customers isn't connected yet. Text them here, or dial them from your phone.",
    };
  }

  const result = await notifier.sendSms({ to: phone, body });

  if (result.skipped || !integrations.twilio()) {
    logger.warn("reminder.send.not_configured", { clientId, appointmentId });
    return { ok: false, error: "Texting isn't connected yet, so nothing was sent." };
  }

  if (!result.ok) {
    await createReminder(clientId, {
      appointmentId,
      channel,
      status: "failed",
      sentAt: null,
      error: result.error ?? "Send failed",
    });
    revalidatePath("/portal/appointments");
    logger.warn("reminder.send.failed", { clientId, appointmentId, channel, error: result.error });
    return {
      ok: false,
      error: explainSmsError(result.code, "Couldn't send the reminder — please try again."),
    };
  }

  await createReminder(clientId, { appointmentId, channel, status: "sent", sentAt: new Date(), error: null });
  revalidatePath("/portal/appointments");
  return { ok: true, message: "Text reminder sent." };
}

/**
 * One-click outbound follow-up to a captured lead — text or call — logged against
 * the lead so the business can see it chased the lead and when. Same demo-safe
 * behavior as appointment reminders.
 */
export async function sendLeadFollowupAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const leadId = String(formData.get("leadId") ?? "");
  const channel = String(formData.get("channel") ?? "") === "call" ? "call" : "sms";

  const user = await assertClientAccess(clientId);
  await assertClientInOrg(user.orgId, clientId);

  const lead = await getClientLead(clientId, leadId);
  if (!lead) return { ok: false, error: "Lead not found." };

  const phone = lead.phone?.trim();
  if (!phone) {
    return { ok: false, error: "No phone number on file for this lead." };
  }
  if (channel === "sms" && (await isOptedOut(phone))) {
    return { ok: false, error: "This number has opted out of texts (replied STOP) — call them instead." };
  }

  const client = await getClientByIdUnsafe(clientId);
  const business = client?.name ?? "us";
  const callbackNumber = client?.escalationNumber?.trim();

  // Prefer the post-call agent's tailored draft (what the UI previews); fall
  // back to the generic follow-up line when no insight exists for this call.
  const insight = lead.callId ? await getInsightForCall(clientId, lead.callId) : null;
  const body =
    insight?.followUpDraft?.trim() ||
    `Hi${lead.name ? ` ${lead.name}` : ""}, this is ${business} following up on your recent call — when's a good time to connect?` +
      (callbackNumber ? ` You can reach us at ${callbackNumber}.` : "");

  // Same rule as appointment reminders: only a real send gets logged as one.
  if (channel === "call") {
    return {
      ok: false,
      error: "Calling leads isn't connected yet. Text them here, or dial them from your phone.",
    };
  }

  const result = await notifier.sendSms({ to: phone, body });

  if (result.skipped || !integrations.twilio()) {
    logger.warn("lead.followup.not_configured", { clientId, leadId });
    return { ok: false, error: "Texting isn't connected yet, so nothing was sent." };
  }

  if (!result.ok) {
    await createReminder(clientId, {
      leadId,
      channel,
      status: "failed",
      sentAt: null,
      error: result.error ?? "Send failed",
    });
    revalidatePath("/portal/leads");
    logger.warn("lead.followup.failed", { clientId, leadId, channel, error: result.error });
    return {
      ok: false,
      error: explainSmsError(result.code, "Couldn't send the follow-up — please try again."),
    };
  }

  await createReminder(clientId, { leadId, channel, status: "sent", sentAt: new Date(), error: null });
  revalidatePath("/portal/leads");
  return { ok: true, message: "Text follow-up sent." };
}
