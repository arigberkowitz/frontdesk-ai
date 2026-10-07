"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { audit } from "@/lib/data/audit";
import { assertClientAccess, requireClientEditor } from "@/lib/auth-guard";
import { assertClientInOrg } from "@/lib/data/clients";
import { sendRebookOffers } from "@/lib/rebooking";
import { type ActionState } from "./types";

/** Settings → Follow-ups: rebooking texts on/off. Admin only; off by default. */
export async function saveSmartRebookingSettingsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const enabled = String(formData.get("enabled") ?? "") === "on";
  const user = await assertClientAccess(clientId);
  if (user.role !== "operator" && user.role !== "client_admin") {
    return { ok: false, error: "Only your account admin can change this." };
  }
  await assertClientInOrg(user.orgId, clientId);
  await db.update(clients).set({ smartRebookingEnabled: enabled }).where(eq(clients.id, clientId));
  void audit({ clientId, actor: user.id, action: "settings.smart_rebooking", detail: { enabled } });
  revalidatePath("/portal/settings", "layout");
  // The Overview's "AI features" switchboard shows this switch too.
  revalidatePath("/portal");
  revalidatePath("/portal/hours");
  return {
    ok: true,
    message: enabled
      ? "On. When you block time over bookings, you can ask those customers to pick a new time."
      : "Off. No rebooking texts will be sent.",
  };
}

const REASON_WORDS: Record<string, string> = {
  opted_out: "opted out",
  no_consent: "no texting permission",
  no_phone: "no mobile number",
  no_slots: "no open times found",
  daily_cap: "daily limit",
  no_calendar: "no calendar connected",
  sms_not_configured: "texting not connected",
  failed: "send failed",
};

/**
 * The owner's explicit "yes, text them". This is the ONLY path that sends a
 * rebooking offer — nothing does it automatically when time is blocked.
 */
export async function sendRebookOffersAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const confirmed = String(formData.get("confirm") ?? "") === "yes";
  const ids = formData
    .getAll("appointmentId")
    .map(String)
    .filter((s) => /^[0-9a-f-]{36}$/i.test(s))
    .slice(0, 200);

  const guard = await requireClientEditor(clientId);
  if (!guard.ok) return { ok: false, error: guard.error };
  await assertClientInOrg(guard.user.orgId, clientId);
  if (!confirmed) return { ok: false, error: "Confirm before we text anyone." };
  if (ids.length === 0) return { ok: false, error: "Pick at least one appointment." };

  const result = await sendRebookOffers(clientId, ids, guard.user.id);
  if ("error" in result) return { ok: false, error: result.error };

  void audit({
    clientId,
    actor: guard.user.id,
    action: "rebook.offers_sent",
    detail: { requested: ids.length, sent: result.sent, skipped: result.skipped },
  });
  revalidatePath("/portal/hours");

  const skipped = Object.entries(result.skipped)
    .map(([k, n]) => `${n} ${REASON_WORDS[k] ?? k}`)
    .join(", ");
  return {
    ok: true,
    message:
      `Texted ${result.sent} ${result.sent === 1 ? "customer" : "customers"} new times.` +
      (skipped ? ` Not texted: ${skipped} — call those ones.` : ""),
  };
}
