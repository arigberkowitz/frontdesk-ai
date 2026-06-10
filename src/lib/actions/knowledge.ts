"use server";

import { assertClientAccess } from "@/lib/auth-guard";
import { knowledgeSchema } from "@/lib/validation";
import { assertClientInOrg } from "@/lib/data/clients";
import * as knowledgeData from "@/lib/data/knowledge";
import { applyClientEdit } from "@/lib/agent-publish";
import { type ActionState, fieldErrorsOf } from "./types";

export async function createKnowledgeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const user = await assertClientAccess(clientId);
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
  await applyClientEdit(user, clientId);
  return { ok: true };
}

export async function updateKnowledgeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const itemId = String(formData.get("itemId") ?? "");
  const user = await assertClientAccess(clientId);
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
  await applyClientEdit(user, clientId);
  return { ok: true };
}

export async function deleteKnowledgeAction(formData: FormData): Promise<void> {
  const clientId = String(formData.get("clientId") ?? "");
  const user = await assertClientAccess(clientId);
  const itemId = String(formData.get("itemId") ?? "");
  await assertClientInOrg(user.orgId, clientId);
  await knowledgeData.deleteKnowledge(clientId, itemId);
  await applyClientEdit(user, clientId);
}
