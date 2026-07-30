"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { availabilityBlocks } from "@/db/schema";
import { requireClientEditor } from "@/lib/auth-guard";
import { assertClientInOrg } from "@/lib/data/clients";
import { applyClientEdit } from "@/lib/agent-publish";
import { zonedTime } from "@/lib/google-calendar";
import { logger } from "@/lib/logger";
import { type ActionState } from "./types";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * "2026-08-04" + "12:00" in the client's zone → the real instant.
 * Reuses the availability engine's own zone math so a closure lands on exactly
 * the boundary the slot grid tests against, DST included.
 */
function zonedInstant(tz: string, date: string, time: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m || !HHMM.test(time)) return null;
  const [hh, mm] = time.split(":").map(Number);
  return zonedTime(tz, Number(m[1]), Number(m[2]) - 1, Number(m[3]), hh, mm);
}

/**
 * Add a break or closure. Two shapes:
 *   kind=recurring  → dayOfWeek ("" = every day) + startTime/endTime
 *   kind=one_off    → startDate/startTime .. endDate/endTime, in client tz
 */
export async function addAvailabilityBlockAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const guard = await requireClientEditor(clientId);
  if (!guard.ok) return { ok: false, error: guard.error };
  const user = guard.user;
  await assertClientInOrg(user.orgId, clientId);

  const client = await db.query.clients.findFirst({
    where: (c, { eq: e }) => e(c.id, clientId),
    columns: { timezone: true },
  });
  const tz = client?.timezone ?? "America/Los_Angeles";

  const label = String(formData.get("label") ?? "").trim().slice(0, 80);
  if (!label) return { ok: false, fieldErrors: { label: ["Give it a name, like Lunch."] } };

  const providerRaw = String(formData.get("providerId") ?? "").trim();
  const providerId = providerRaw || null;
  const kind = String(formData.get("kind") ?? "recurring");

  if (kind === "recurring") {
    const startTime = String(formData.get("startTime") ?? "");
    const endTime = String(formData.get("endTime") ?? "");
    if (!HHMM.test(startTime) || !HHMM.test(endTime)) {
      return { ok: false, fieldErrors: { startTime: ["Use times like 12:00 and 13:00."] } };
    }
    if (endTime <= startTime) {
      return { ok: false, fieldErrors: { endTime: ["The end time has to be after the start."] } };
    }
    const dowRaw = String(formData.get("dayOfWeek") ?? "");
    const dayOfWeek = dowRaw === "" ? null : Number(dowRaw);
    if (dayOfWeek !== null && !(dayOfWeek >= 0 && dayOfWeek <= 6)) {
      return { ok: false, error: "Pick a valid day." };
    }
    await db.insert(availabilityBlocks).values({
      clientId,
      providerId,
      label,
      dayOfWeek,
      startTime,
      endTime,
    });
  } else {
    const startDate = String(formData.get("startDate") ?? "");
    const endDate = String(formData.get("endDate") ?? "") || startDate;
    const startTime = String(formData.get("startTimeOneOff") ?? "") || "00:00";
    const endTime = String(formData.get("endTimeOneOff") ?? "") || "23:59";
    const startsAt = zonedInstant(tz, startDate, startTime);
    const endsAt = zonedInstant(tz, endDate, endTime);
    if (!startsAt || !endsAt) {
      return { ok: false, fieldErrors: { startDate: ["Pick a start and end date."] } };
    }
    if (endsAt <= startsAt) {
      return { ok: false, fieldErrors: { endDate: ["The end has to be after the start."] } };
    }
    await db.insert(availabilityBlocks).values({ clientId, providerId, label, startsAt, endsAt });
  }

  // The prompt tells callers what the AI can do; republish so it reflects reality.
  await applyClientEdit(user, clientId);
  logger.info("availability.block.added", { clientId, kind });
  revalidatePath("/portal/hours");
  revalidatePath("/portal", "layout");
  return { ok: true, message: `Added "${label}" — your AI won't book over it.` };
}

/** Remove a break/closure. Scoped to the client so ids can't be guessed across tenants. */
export async function deleteAvailabilityBlockAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const id = String(formData.get("blockId") ?? "");
  const guard = await requireClientEditor(clientId);
  if (!guard.ok) return { ok: false, error: guard.error };
  await assertClientInOrg(guard.user.orgId, clientId);

  await db
    .delete(availabilityBlocks)
    .where(and(eq(availabilityBlocks.id, id), eq(availabilityBlocks.clientId, clientId)));

  await applyClientEdit(guard.user, clientId);
  revalidatePath("/portal/hours");
  revalidatePath("/portal", "layout");
  return { ok: true, message: "Removed — those times are bookable again." };
}
