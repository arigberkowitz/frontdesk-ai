"use server";

import { revalidatePath } from "next/cache";
import { requireClientEditor } from "@/lib/auth-guard";
import { guidelinesSchema, emptyToNull } from "@/lib/validation";
import { assertClientInOrg, updateClient } from "@/lib/data/clients";
import { applyClientEdit } from "@/lib/agent-publish";
import { updateAgentVoice } from "@/lib/retell";
import { integrations } from "@/lib/env";
import { type ActionState, fieldErrorsOf } from "./types";
import type { NewClient } from "@/db/schema";

const FIELDS = ["greeting", "agentGuidance", "bookingInstructions"] as const;

/**
 * Save the company-authored greeting / guardrails / booking rules. Each portal
 * card submits only its own field, so we update just what was sent — saving the
 * greeting never wipes the other two. This form lives only in the client portal,
 * so a save always publishes to the live agent.
 */
export async function saveGuidelinesAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const guard = await requireClientEditor(clientId);
  if (!guard.ok) return { ok: false, error: guard.error };
  const user = guard.user;
  // Collect only the field(s) this card actually submitted.
  const raw: Record<string, FormDataEntryValue> = {};
  for (const f of FIELDS) {
    const v = formData.get(f);
    if (v !== null) raw[f] = v;
  }
  const parsed = guidelinesSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };

  const patch: Partial<NewClient> = {};
  if ("greeting" in raw) patch.greeting = emptyToNull(parsed.data.greeting);
  if ("agentGuidance" in raw) patch.agentGuidance = emptyToNull(parsed.data.agentGuidance);
  if ("bookingInstructions" in raw) {
    patch.bookingInstructions = emptyToNull(parsed.data.bookingInstructions);
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: "Nothing to save." };

  await assertClientInOrg(user.orgId, clientId);
  await updateClient(user.orgId, clientId, patch);
  await applyClientEdit(user, clientId);
  return { ok: true };
}

/**
 * Set a specific voice by its Retell voice id (the grouped Women/Men dropdown).
 * Like setVoiceAction, but the caller picks an exact voice rather than a gender.
 */
export async function setVoiceByIdAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const voiceId = String(formData.get("voiceId") ?? "").trim();
  if (!voiceId || voiceId.length > 120) return { ok: false, error: "Pick a voice." };

  const guard = await requireClientEditor(clientId);

  if (!guard.ok) return { ok: false, error: guard.error };

  const user = guard.user;
  await assertClientInOrg(user.orgId, clientId);

  const client = await updateClient(user.orgId, clientId, { voiceId });

  if (client.retellAgentId && integrations.retell()) {
    try {
      await updateAgentVoice(client.retellAgentId, voiceId);
    } catch {
      return { ok: false, error: "Saved your choice, but couldn't update the live voice — try again." };
    }
  }

  revalidatePath("/portal/guidelines");
  revalidatePath(`/clients/${clientId}`);
  return { ok: true };
}
