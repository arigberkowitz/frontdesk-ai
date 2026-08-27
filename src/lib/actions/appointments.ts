"use server";

import { db } from "@/db";
import { and, eq } from "drizzle-orm";
import { appointments as appointmentsTable } from "@/db/schema";
import { audit } from "@/lib/data/audit";
import { getClientAppointment } from "@/lib/data/reminders";
import { requireClientEditor } from "@/lib/auth-guard";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { emitWebhook } from "@/lib/webhooks-emit";
import { offerFreedSlot } from "@/lib/agents/waitlist-backfill";
import { assertClientAccess } from "@/lib/auth-guard";
import { assertClientInOrg, getClientByIdUnsafe } from "@/lib/data/clients";
import {
  cancelAppointment,
  createAppointment,
  hasOverlappingAppointment,
} from "@/lib/data/appointments";
import { getBookingProviderForClient } from "@/lib/booking";
import { logger } from "@/lib/logger";
import { isProviderFree, listProviders } from "@/lib/data/providers";
import { parseInClientTimezone } from "@/lib/hours-util";
import { vocabFor } from "@/lib/vocab";
import { type ActionState, fieldErrorsOf } from "./types";

/**
 * Manual appointment entry: walk-ins, phone calls the owner took themselves,
 * regulars booked at the front desk. Any portal user (including staff) can add
 * one — it's day-to-day operations, not AI configuration.
 */

const manualApptSchema = z.object({
  customerName: z.string().trim().max(120).optional(),
  customerPhone: z.string().trim().max(40).optional(),
  serviceId: z.string().trim().optional(),
  providerId: z.string().trim().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Pick a time"),
  durationMin: z.coerce.number().int().min(5).max(480).optional(),
});

export async function createManualAppointmentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const user = await assertClientAccess(clientId);
  await assertClientInOrg(user.orgId, clientId);

  const parsed = manualApptSchema.safeParse({
    customerName: formData.get("customerName") ?? undefined,
    customerPhone: formData.get("customerPhone") ?? undefined,
    serviceId: formData.get("serviceId") ?? undefined,
    providerId: formData.get("providerId") ?? undefined,
    date: formData.get("date"),
    time: formData.get("time"),
    durationMin: formData.get("durationMin") || undefined,
  });
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };
  const d = parsed.data;

  const client = await getClientByIdUnsafe(clientId);
  if (!client) return { ok: false, error: "Business not found." };
  const v = vocabFor(client.industry);

  // Interpret the picked date+time in the business's timezone, not the server's.
  const startAt = parseInClientTimezone(`${d.date}T${d.time}`, client.timezone);
  if (!startAt) return { ok: false, error: "That date and time didn't parse — try again." };

  const service = d.serviceId ? client.services.find((s) => s.id === d.serviceId) : undefined;
  if (d.serviceId && !service) return { ok: false, error: "That service no longer exists." };

  const durationMin = d.durationMin ?? service?.durationMin ?? 30;
  const endAt = new Date(startAt.getTime() + durationMin * 60_000);

  // Same clash rules the AI follows — with a human override for deliberate
  // double-booking (squeezing a regular in is the front desk's call to make).
  const allowOverlap = formData.get("allowOverlap") !== null;
  const providerId = d.providerId || null;
  if (!allowOverlap) {
    if (providerId) {
      if (!(await isProviderFree(clientId, providerId, startAt, endAt))) {
        const who = (await listProviders(clientId)).find((p) => p.id === providerId)?.name ?? "They";
        return {
          ok: false,
          error: `${who} already has an overlapping ${v.appointment} then. Pick another time, or tick "book anyway".`,
        };
      }
    } else if (await hasOverlappingAppointment(clientId, startAt, endAt, service)) {
      return {
        ok: false,
        error: `That slot clashes with an existing ${v.appointment}. Pick another time, or tick "book anyway".`,
      };
    }
  }

  const created = await createAppointment(clientId, {
    callId: null,
    customerName: d.customerName || null,
    customerPhone: d.customerPhone || null,
    serviceId: service?.id ?? null,
    providerId,
    startAt,
    endAt,
    status: "booked",
    externalBookingId: null,
  });

  // A booking typed in by hand is still a booking the CRM wants. Firing only
  // from the AI path would leave a business's records half-synced in a way
  // nobody would ever guess from the settings screen.
  void emitWebhook(clientId, "appointment.booked", {
    appointmentId: created.id,
    customerName: created.customerName,
    customerPhone: created.customerPhone,
    service: service?.name ?? null,
    startAt: created.startAt.toISOString(),
    endAt: created.endAt?.toISOString() ?? null,
    status: created.status,
    source: "manual",
    callId: null,
  });

  revalidatePath("/portal/appointments");
  revalidatePath("/portal");
  revalidatePath(`/clients/${clientId}`);
  return { ok: true, message: `${v.appointment[0].toUpperCase()}${v.appointment.slice(1)} added.` };
}

/**
 * Manual cancellation from the portal or operator dashboard. Frees the slot
 * (cancelled appointments stop counting against capacity) and, when the
 * booking lives on an external calendar too, cancels it there best-effort.
 */
export async function cancelAppointmentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const user = await assertClientAccess(clientId);
  await assertClientInOrg(user.orgId, clientId);
  const appointmentId = String(formData.get("appointmentId") ?? "");
  if (!appointmentId) return { ok: false, error: "Missing appointment." };

  const client = await getClientByIdUnsafe(clientId);
  if (!client) return { ok: false, error: "Business not found." };
  const v = vocabFor(client.industry);

  const cancelled = await cancelAppointment(clientId, appointmentId);
  if (!cancelled) return { ok: false, error: `That ${v.appointment} no longer exists.` };

  // A slot freed by hand is exactly as free as one freed by the AI. Wiring only
  // the AI path would make this feature work half the time, for a reason no
  // owner could ever guess from the outside.
  void offerFreedSlot(client, {
    startAt: cancelled.startAt,
    endAt: cancelled.endAt,
    serviceId: cancelled.serviceId,
  });

  // Cancelling on the real calendar can fail — an expired token, Google down —
  // and that failure used to be logged and then contradicted by a cheerful "the
  // slot is open again". It isn't: the event is still on the owner's calendar,
  // blocking the slot, and the one person who could fix it has been told
  // everything is fine. Say what actually happened.
  let calendarStillHolds = false;
  if (cancelled.externalBookingId) {
    try {
      const provider = getBookingProviderForClient(client);
      if (provider.isConfigured()) {
        await provider.cancelBooking(cancelled.externalBookingId, "Cancelled from FrontDesk AI");
      }
    } catch (err) {
      calendarStillHolds = true;
      logger.error("appointments.cancel.provider_failed", {
        clientId,
        appointmentId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  revalidatePath("/portal/appointments");
  revalidatePath("/portal");
  revalidatePath(`/clients/${clientId}`);
  const noun = `${v.appointment[0].toUpperCase()}${v.appointment.slice(1)}`;
  return {
    ok: true,
    message: calendarStillHolds
      ? `${noun} cancelled here, but we couldn't remove it from your calendar — please delete that event yourself.`
      : `${noun} cancelled — the slot is open again.`,
  };
}

/**
 * Mark a deposit paid, or waive it.
 *
 * Manual because we don't run the checkout — the money went straight to the
 * business's own Stripe or Square, so this app never sees it land. That is the
 * honest cost of staying out of other people's money, and the honest fix is
 * Stripe Connect, not a webhook we can't receive.
 */
export async function setDepositStatusAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const appointmentId = String(formData.get("appointmentId") ?? "");
  const next = String(formData.get("depositStatus") ?? "");
  if (next !== "paid" && next !== "waived" && next !== "requested") {
    return { ok: false, error: "Unknown deposit status." };
  }

  const guard = await requireClientEditor(clientId);
  if (!guard.ok) return { ok: false, error: guard.error };
  await assertClientInOrg(guard.user.orgId, clientId);

  const appt = await getClientAppointment(clientId, appointmentId);
  if (!appt) return { ok: false, error: "That appointment no longer exists." };

  await db
    .update(appointmentsTable)
    .set({ depositStatus: next, depositMarkedAt: new Date() })
    .where(and(eq(appointmentsTable.id, appointmentId), eq(appointmentsTable.clientId, clientId)));

  void audit({
    clientId,
    actor: guard.user.id,
    action: "appointment.deposit_status",
    detail: { appointmentId, status: next },
  });
  revalidatePath("/portal/appointments");
  revalidatePath(`/clients/${clientId}`);
  return {
    ok: true,
    message: next === "paid" ? "Marked paid." : next === "waived" ? "Deposit waived." : "Reset.",
  };
}
