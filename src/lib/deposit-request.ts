import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appointments, type Appointment, type Client } from "@/db/schema";
import { createReminder } from "@/lib/data/reminders";
import { isOptedOut } from "@/lib/data/sms-optouts";
import { decideDeposit, depositRequestBody } from "@/lib/deposits";
import { describeOpening } from "@/lib/waitlist";
import { notifier } from "@/lib/notifier";
import { logger } from "@/lib/logger";

/**
 * Text the deposit link, right after the booking is made.
 *
 * Timing is the whole point: a deposit asked for while the customer still has
 * the appointment in mind gets paid, and the same message three days later gets
 * ignored. Never awaited — the caller may still be on the line.
 *
 * `smsConsent` is not optional and not inferred. This is a text to a consumer
 * asking them for money; the caller must have said yes to being texted on the
 * call, in those words, or nothing is sent.
 */
export async function requestDeposit(input: {
  client: Client;
  appointment: Appointment;
  serviceDepositCents: number | null;
  smsConsent: boolean;
}): Promise<boolean> {
  const { client, appointment } = input;
  try {
    const decision = decideDeposit({
      depositsEnabled: client.depositsEnabled,
      depositLinkUrl: client.depositLinkUrl,
      serviceDepositCents: input.serviceDepositCents,
    });
    if (!decision.required || decision.amountCents == null) return false;
    if (!input.smsConsent) {
      logger.info("deposit.skipped_no_consent", { appointmentId: appointment.id });
      return false;
    }
    const to = appointment.customerPhone?.trim();
    if (!to) return false;
    if (await isOptedOut(to)) return false;

    const body = depositRequestBody({
      businessName: client.name,
      customerName: appointment.customerName,
      amountCents: decision.amountCents,
      when: describeOpening(appointment.startAt, client.timezone),
      payUrl: client.depositLinkUrl!.trim(),
    });
    const result = await notifier.sendSms({ to, body });
    if (result.skipped) return false;

    const failed = !result.ok;
    await createReminder(client.id, {
      appointmentId: appointment.id,
      leadId: null,
      channel: "sms",
      kind: "deposit_request",
      status: failed ? "failed" : "sent",
      sentAt: failed ? null : new Date(),
      error: failed ? (result.error ?? "Send failed") : null,
      providerSid: result.id ?? null,
    });

    if (!failed) {
      // "requested" records what we asked for, not what anybody owes. The money
      // is between the customer and the business; we only sent the link.
      await db
        .update(appointments)
        .set({
          depositStatus: "requested",
          depositAmountCents: decision.amountCents,
          depositMarkedAt: new Date(),
        })
        .where(eq(appointments.id, appointment.id));
    }
    return !failed;
  } catch (err) {
    logger.error("deposit.request_failed", {
      appointmentId: appointment.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
