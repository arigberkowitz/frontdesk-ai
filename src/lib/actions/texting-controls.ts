"use server";

import { revalidatePath } from "next/cache";
import { requireClientOwner } from "@/lib/auth-guard";
import { audit } from "@/lib/data/audit";
import { saveTextingPrefs } from "@/lib/data/texting-prefs";
import { env } from "@/lib/env";
import { type ActionState } from "./types";

function hour(v: FormDataEntryValue | null): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : null;
}

/** Settings → Phone & AI: the owner's texting switch and quiet hours. Owner-only. */
export async function saveTextingControlsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!env.OWNER_TEXTING_CONTROLS) return { ok: false, error: "Not available yet." };
  const clientId = String(formData.get("clientId") ?? "");
  const guard = await requireClientOwner(clientId);
  if (!guard.ok) return { ok: false, error: guard.error };
  const textingEnabled = formData.get("textingEnabled") === "on";
  const quietStartHour = hour(formData.get("quietStartHour"));
  const quietEndHour = hour(formData.get("quietEndHour"));
  if (quietStartHour === null || quietEndHour === null) return { ok: false, error: "Pick a start and end hour." };
  await saveTextingPrefs(clientId, { textingEnabled, quietStartHour, quietEndHour });
  void audit({ clientId, actor: guard.user.id, action: "texting.controls_saved", detail: { textingEnabled, quietStartHour, quietEndHour } });
  revalidatePath("/portal/settings/phone");
  return { ok: true, message: textingEnabled ? "Saved." : "Saved. Automatic texts are off." };
}
