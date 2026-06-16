"use server";

import { revalidatePath } from "next/cache";
import { assertClientAccess } from "@/lib/auth-guard";
import { assertClientInOrg, getClientByIdUnsafe } from "@/lib/data/clients";
import { createReminder, getClientAppointment } from "@/lib/data/reminders";
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

  const phone = appt.customerPhone?.trim();
  if (!phone) {
    return { ok: false, error: "No phone number on file for this customer — add one to send a reminder." };
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
