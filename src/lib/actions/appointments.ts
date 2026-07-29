"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { assertClientAccess } from "@/lib/auth-guard";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import { createAppointment, hasOverlappingAppointment } from "@/lib/data/appointments";
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
  await assertClientAccess(clientId);

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

  await createAppointment(clientId, {
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

  revalidatePath("/portal/appointments");
  revalidatePath("/portal");
  revalidatePath(`/clients/${clientId}`);
  return { ok: true, message: `${v.appointment[0].toUpperCase()}${v.appointment.slice(1)} added.` };
}
