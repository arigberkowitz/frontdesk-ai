"use server";

import { assertClientEditor } from "@/lib/auth-guard";
import { assertClientInOrg } from "@/lib/data/clients";
import { setWeekHours, type DayHoursInput } from "@/lib/data/hours";
import { applyClientEdit } from "@/lib/agent-publish";
import type { ActionState } from "./types";

export async function saveHoursAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const user = await assertClientEditor(clientId);
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
  await applyClientEdit(user, clientId);
  return { ok: true };
}
