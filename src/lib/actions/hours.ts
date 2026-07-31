"use server";

import { requireClientEditor } from "@/lib/auth-guard";
import { assertClientInOrg } from "@/lib/data/clients";
import { setWeekHours, type DayHoursInput } from "@/lib/data/hours";
import { applyClientEdit, withSyncNote } from "@/lib/agent-publish";
import type { ActionState } from "./types";

export async function saveHoursAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const guard = await requireClientEditor(clientId);
  if (!guard.ok) return { ok: false, error: guard.error };
  const user = guard.user;
  await assertClientInOrg(user.orgId, clientId);

  const days: DayHoursInput[] = [];
  for (let d = 0; d < 7; d++) {
    const isClosed = formData.get(`closed_${d}`) !== null;
    const open = String(formData.get(`open_${d}`) ?? "").trim();
    const close = String(formData.get(`close_${d}`) ?? "").trim();
    days.push({
      dayOfWeek: d,
      isClosed,
      openTime: isClosed || !open ? null : open,
      closeTime: isClosed || !close ? null : close,
    });
  }

  await setWeekHours(clientId, days);
  const sync = await applyClientEdit(user, clientId);
  return { ok: true, message: withSyncNote("Hours saved.", sync) };
}
