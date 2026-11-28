"use server";

import { revalidatePath } from "next/cache";
import { assertClientAccess } from "@/lib/auth-guard";
import { assertClientInOrg } from "@/lib/data/clients";
import { audit } from "@/lib/data/audit";
import { applyClientEdit, withSyncNote } from "@/lib/agent-publish";
import { planAccessFor, UPGRADE_MESSAGES } from "@/lib/plan-access";
import { getSettings, saveSettings } from "@/lib/revenue/quote-followup-data";
import { templateProblem } from "@/lib/revenue/quote-followup";
import { quoteConsentAskOn } from "@/lib/revenue/quote-consent";
import { type ActionState } from "./types";

/**
 * Quote follow-up texts: the on/off switch, the two editable messages, and
 * the separate "have the AI ask price callers if it can text them" switch.
 * Both switches are off by default and Pro only (checked here, on the server;
 * switching either OFF always works). Only the account admin (or an operator)
 * can change it, because these texts leave on the business's own number,
 * unattended. The same action serves the owner's Settings and the operator's
 * client page.
 *
 * When the save changes whether the AI asks, the live agent is republished
 * (auto-publish, #105) so the phone line matches the switch.
 */
export async function saveQuoteFollowupAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const enabled = String(formData.get("enabled") ?? "") === "on";
  const askConsentRaw = String(formData.get("askConsent") ?? "") === "on";
  const step1 = String(formData.get("step1Template") ?? "").trim();
  const step2 = String(formData.get("step2Template") ?? "").trim();

  const user = await assertClientAccess(clientId);
  if (user.role !== "operator" && user.role !== "client_admin") {
    return { ok: false, error: "Only your account admin can change this." };
  }
  const client = await assertClientInOrg(user.orgId, clientId);

  const access = await planAccessFor(client).catch(() => null);
  // Unknown plan fails CLOSED for turning on: texts and an AI that asks to
  // text need a positive Pro answer. Off always saves.
  const planAllows = access ? access.has("quote_followup") : false;
  if ((enabled || askConsentRaw) && !planAllows) {
    return { ok: false, error: UPGRADE_MESSAGES.quote_followup };
  }

  const problem = templateProblem(step1) ?? templateProblem(step2);
  if (problem) return { ok: false, error: problem };

  // The ask only makes sense with follow-up on: no follow-up, no reason to ask.
  const askConsent = enabled && askConsentRaw;

  const before = await getSettings(clientId);
  await saveSettings(clientId, {
    enabled,
    // Keep the original turn-on time unless it's being turned on fresh.
    enabledAt: enabled ? (before.enabled && before.enabledAt ? before.enabledAt : new Date().toISOString()) : before.enabledAt,
    step1Template: step1 || undefined,
    step2Template: step2 || undefined,
    askConsent,
  });

  void audit({
    clientId,
    actor: user.id,
    action: "settings.quote_followup",
    detail: {
      enabled,
      wasEnabled: before.enabled,
      askConsent,
      wasAskConsent: before.askConsent === true,
      customMessage1: Boolean(step1),
      customMessage2: Boolean(step2),
    },
  });

  // Republish only when what the AI says on calls actually changed.
  const askedBefore = quoteConsentAskOn({ planAllows, settings: before });
  const asksNow = quoteConsentAskOn({ planAllows, settings: { enabled, askConsent } });
  revalidatePath("/portal/settings", "layout");
  revalidatePath(`/clients/${clientId}`);

  const base = enabled
    ? asksNow
      ? "On. Callers who ask for a price and don't book get a text a day later and again a week later, and your AI now asks them if it can text."
      : "On. Callers who ask for a price and don't book get a text a day later and again a week later."
    : "Off. Nobody will get these texts.";
  if (askedBefore !== asksNow) {
    const sync = await applyClientEdit(user, clientId);
    const what = asksNow ? base : `${base} Your AI no longer asks price callers if it can text them.`;
    return { ok: true, message: withSyncNote(what, sync) };
  }
  return { ok: true, message: base };
}
