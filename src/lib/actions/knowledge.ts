"use server";

import { requireClientEditor } from "@/lib/auth-guard";
import { knowledgeSchema } from "@/lib/validation";
import { assertClientInOrg } from "@/lib/data/clients";
import * as knowledgeData from "@/lib/data/knowledge";
import { applyClientEdit, withSyncNote } from "@/lib/agent-publish";
import { type ActionState, fieldErrorsOf } from "./types";

export async function createKnowledgeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const guard = await requireClientEditor(clientId);
  if (!guard.ok) return { ok: false, error: guard.error };
  const user = guard.user;
  const parsed = knowledgeSchema.safeParse({
    question: formData.get("question"),
    answer: formData.get("answer"),
    isActive: formData.get("isActive") !== null ? formData.get("isActive") !== "false" : true,
  });
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };

  await assertClientInOrg(user.orgId, clientId);
  await knowledgeData.createKnowledge(clientId, {
    question: parsed.data.question,
    answer: parsed.data.answer,
    source: "manual",
    isActive: parsed.data.isActive,
  });
  const sync = await applyClientEdit(user, clientId);
  return { ok: true, message: withSyncNote("Saved.", sync) };
}

export async function updateKnowledgeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const itemId = String(formData.get("itemId") ?? "");
  const guard = await requireClientEditor(clientId);
  if (!guard.ok) return { ok: false, error: guard.error };
  const user = guard.user;
  const parsed = knowledgeSchema.safeParse({
    question: formData.get("question"),
    answer: formData.get("answer"),
    isActive: formData.get("isActive") !== null ? formData.get("isActive") !== "false" : true,
  });
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };

  await assertClientInOrg(user.orgId, clientId);
  await knowledgeData.updateKnowledge(clientId, itemId, {
    question: parsed.data.question,
    answer: parsed.data.answer,
    isActive: parsed.data.isActive,
  });
  const sync = await applyClientEdit(user, clientId);
  return { ok: true, message: withSyncNote("Saved.", sync) };
}

export async function deleteKnowledgeAction(formData: FormData): Promise<void> {
  const clientId = String(formData.get("clientId") ?? "");
  const guard = await requireClientEditor(clientId);
  if (!guard.ok) return; // locked staff: silent no-op (banner explains)
  const user = guard.user;
  const itemId = String(formData.get("itemId") ?? "");
  await assertClientInOrg(user.orgId, clientId);
  await knowledgeData.deleteKnowledge(clientId, itemId);
  await applyClientEdit(user, clientId);
}
