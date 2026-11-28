"use server";

import { revalidatePath } from "next/cache";
import { assertClientAccess } from "@/lib/auth-guard";
import { assertClientInOrg } from "@/lib/data/clients";
import { audit } from "@/lib/data/audit";
import {
  getSettings,
  saveSettings,
} from "@/lib/revenue/quote-followup-data";
import { templateProblem } from "@/lib/revenue/quote-followup";
import { type ActionState } from "./types";

/**
 * Quote follow-up texts: the on/off switch and the two editable messages.
 * Off by default. Only the account admin (or an operator) can change it,
 * because these texts leave on the business's own number, unattended.
 * The same action serves the owner's Settings and the operator's client page.
 */
export async function saveQuoteFollowupAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const enabled = String(formData.get("enabled") ?? "") === "on";
  const step1 = String(formData.get("step1Template") ?? "").trim();
  const step2 = String(formData.get("step2Template") ?? "").trim();

  const user = await assertClientAccess(clientId);
  if (user.role !== "operator" && user.role !== "client_admin") {
    return { ok: false, error: "Only your account admin can change this." };
  }
  await assertClientInOrg(user.orgId, clientId);

  const problem = templateProblem(step1) ?? templateProblem(step2);
  if (problem) return { ok: false, error: problem };

  const before = await getSettings(clientId);
  await saveSettings(clientId, {
    enabled,
    // Keep the original turn-on time unless it's being turned on fresh.
    enabledAt: enabled ? (before.enabled && before.enabledAt ? before.enabledAt : new Date().toISOString()) : before.enabledAt,
    step1Template: step1 || undefined,
    step2Template: step2 || undefined,
  });

  void audit({
    clientId,
    actor: user.id,
    action: "settings.quote_followup",
    detail: { enabled, wasEnabled: before.enabled, customMessage1: Boolean(step1), customMessage2: Boolean(step2) },
  });
  revalidatePath("/portal/settings", "layout");
  revalidatePath(`/clients/${clientId}`);
  return {
    ok: true,
    message: enabled
      ? "On. Callers who ask for a price and don't book get a text a day later and again a week later."
      : "Off. Nobody will get these texts.",
  };
}
