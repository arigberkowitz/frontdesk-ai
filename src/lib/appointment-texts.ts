import "server-only";
import { and, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { appointments, clients, type Appointment, type Client } from "@/db/schema";
import { notifier } from "./notifier";
import { createReminder } from "./data/reminders";
import { isOptedOut } from "./data/sms-optouts";
import { confirmationText, dueForReminder, reminderText, withinTextingHours } from "./appointment-messages";
import { formatDateTime } from "./format";
import { logger } from "./logger";

/**
 * Sending the two customer texts.
 *
 * Consent is recorded as a fact rather than a flag: a confirmation text only
 * goes out when the agent passed `sms_consent`, and the day-before reminder
 * only goes to someone who already received that confirmation. So the reminder
 * inherits its permission from a text the customer agreed to and received,
 * which needs no new column and cannot drift out of step with reality.
 */

function whenFor(client: Client, at: Date): string {
  return formatDateTime(at, client.timezone);
}

/** "you're booked" — sent within seconds of the call ending. */
export async function sendBookingConfirmation(
  client: Client,
  appt: Appointment,
  serviceName?: string | null,
): Promise<void> {
  const to = appt.customerPhone?.trim();
  if (!to) return;
  if (await isOptedOut(to)) {
    logger.info("appointment.confirmation.opted_out", { appointmentId: appt.id });
    return;
  }

  const body = confirmationText({
    business: client.name,
    customerName: appt.customerName,
    serviceName,
    when: whenFor(client, appt.startAt),
    callbackNumber: client.escalationNumber?.trim() || null,
    meetingUrl: appt.meetingUrl,
  });

  const result = await notifier.sendSms({ to, body });
  if (result.skipped) {
    // Texting isn't connected. Say so in the log rather than recording a send —
    // and note that the caller was promised this text on a recorded line.
    logger.error("appointment.confirmation.not_configured", {
      clientId: client.id,
      appointmentId: appt.id,
      detail: "Caller agreed to a confirmation text and none could be sent — SMS is not connected.",
    });
    return;
  }

  await createReminder(client.id, {
    appointmentId: appt.id,
    channel: "sms",
    kind: "appointment_reminder",
    status: result.ok ? "sent" : "failed",
    sentAt: result.ok ? new Date() : null,
    error: result.ok ? null : (result.error ?? "Send failed"),
    providerSid: result.id ?? null,
  });
  logger.info("appointment.confirmation.sent", { appointmentId: appt.id, ok: result.ok });
}

export interface ReminderSweepResult {
  clients: number;
  sent: number;
  skipped: number;
  failed: number;
}

/**
 * The day-before nudge, swept once a day across every live business.
 *
 * Runs per client so it can respect each one's timezone: a business in Hawaii
 * and one in Boston should both text at a civilized local hour, not whenever
 * the cron happens to fire.
 */
export async function sendAppointmentReminders(now: Date = new Date()): Promise<ReminderSweepResult> {
  const active = await db.query.clients.findMany({
    where: and(sql`${clients.status} in ('live','trial')`, isNull(clients.deletedAt)),
  });

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const client of active) {
    try {
      if (!withinTextingHours(now, client.timezone)) {
        skipped += 1;
        continue;
      }

      const HOUR = 3_600_000;
      const rows = await db.query.appointments.findMany({
        where: and(
          eq(appointments.clientId, client.id),
          isNull(appointments.deletedAt),
          gte(appointments.startAt, new Date(now.getTime() + 6 * HOUR)),
          lte(appointments.startAt, new Date(now.getTime() + 48 * HOUR)),
        ),
        with: { service: { columns: { name: true } }, reminders: { columns: { id: true } } },
      });

      const due = dueForReminder(
        rows.map((a) => ({
          id: a.id,
          startAt: a.startAt,
          customerPhone: a.customerPhone,
          customerName: a.customerName,
          status: a.status,
          textsAlreadySent: a.reminders.length,
        })),
        now.getTime(),
      );

      for (const a of due) {
        const to = a.customerPhone!.trim();
        if (await isOptedOut(to)) {
          skipped += 1;
          continue;
        }
        const row = rows.find((r) => r.id === a.id)!;
        const body = reminderText({
          business: client.name,
          customerName: a.customerName,
          when: whenFor(client, a.startAt),
          callbackNumber: client.escalationNumber?.trim() || null,
          meetingUrl: row.meetingUrl,
        });
        const result = await notifier.sendSms({ to, body });
        if (result.skipped) {
          skipped += 1;
          continue;
        }
        await createReminder(client.id, {
          appointmentId: a.id,
          channel: "sms",
          kind: "appointment_reminder",
          status: result.ok ? "sent" : "failed",
          sentAt: result.ok ? new Date() : null,
          error: result.ok ? null : (result.error ?? "Send failed"),
          providerSid: result.id ?? null,
        });
        if (result.ok) sent += 1;
        else failed += 1;
      }
    } catch (err) {
      failed += 1;
      logger.error("appointment.reminders.client_failed", {
        clientId: client.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info("appointment.reminders.run", { clients: active.length, sent, skipped, failed });
  return { clients: active.length, sent, skipped, failed };
}
