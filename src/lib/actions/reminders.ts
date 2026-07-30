"use server";

import { revalidatePath } from "next/cache";
import { assertClientAccess } from "@/lib/auth-guard";
import { assertClientInOrg, getClientByIdUnsafe } from "@/lib/data/clients";
import { createReminder, getClientAppointment } from "@/lib/data/reminders";
import { getClientLead } from "@/lib/data/leads";
import { getInsightForCall } from "@/lib/data/insights";
import { isOptedOut } from "@/lib/data/sms-optouts";
import { notifier } from "@/lib/notifier";
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
    (callbackNumber ? ` Need to reschedule? Call ${callbackNumber}.` : "");

  // Text sends for real via Twilio when configured. Outbound voice reminders ride
  // the same logging path and place a real call once outbound telephony is wired;
  // until then both are recorded as a demo send so the log is populated.
  const result =
    channel === "sms" ? await notifier.sendSms({ to: phone, body }) : { ok: false, skipped: true as const };

  const demo = Boolean(result.skipped) || !integrations.twilio();
  const failed = !result.ok && !result.skipped;

  await createReminder(clientId, {
    appointmentId,
    channel,
    status: failed ? "failed" : "sent",
    sentAt: failed ? null : new Date(),
    error: failed ? (result.error ?? "Send failed") : null,
  });

  revalidatePath("/portal/appointments");

  if (failed) {
    logger.warn("reminder.send.failed", { clientId, appointmentId, channel, error: result.error });
    return { ok: false, error: "Couldn't send the reminder — please try again." };
  }
  return {
    ok: true,
    message:
      channel === "sms"
        ? demo
          ? "Text reminder logged (demo — connect texting to send for real)."
          : "Text reminder sent."
        : "Call reminder logged (demo — connect calling to dial for real).",
  };
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

  const result =
    channel === "sms" ? await notifier.sendSms({ to: phone, body }) : { ok: false, skipped: true as const };

  const demo = Boolean(result.skipped) || !integrations.twilio();
  const failed = !result.ok && !result.skipped;

  await createReminder(clientId, {
    leadId,
    channel,
    status: failed ? "failed" : "sent",
    sentAt: failed ? null : new Date(),
    error: failed ? (result.error ?? "Send failed") : null,
  });

  revalidatePath("/portal/leads");

  if (failed) {
    logger.warn("lead.followup.failed", { clientId, leadId, channel, error: result.error });
    return { ok: false, error: "Couldn't send the follow-up — please try again." };
  }
  return {
    ok: true,
    message:
      channel === "sms"
        ? demo
          ? "Text follow-up logged (demo — connect texting to send for real)."
          : "Text follow-up sent."
        : "Call follow-up logged (demo — connect calling to dial for real).",
  };
}
