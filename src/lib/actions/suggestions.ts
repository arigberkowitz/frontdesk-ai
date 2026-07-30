"use server";

import { revalidatePath } from "next/cache";
import { requireClientEditor } from "@/lib/auth-guard";
import { assertClientInOrg, getClientByIdUnsafe } from "@/lib/data/clients";
import { getSuggestion, markSuggestion } from "@/lib/data/suggestions";
import { createKnowledge } from "@/lib/data/knowledge";
import { applyClientEdit } from "@/lib/agent-publish";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * Human-in-the-loop gate for agent #1: approving a suggestion is the ONLY path
 * by which the nightly loop's output reaches the live agent. Approve writes the
 * knowledge / guidance, then republishes the Retell prompt.
 */

export async function approveSuggestionAction(formData: FormData): Promise<void> {
  const clientId = String(formData.get("clientId") ?? "");
  const suggestionId = String(formData.get("suggestionId") ?? "");
  const guard = await requireClientEditor(clientId);
  if (!guard.ok) return; // locked staff: silent no-op (banner explains)
  const user = guard.user;
  await assertClientInOrg(user.orgId, clientId);

  const suggestion = await getSuggestion(clientId, suggestionId);
  if (!suggestion || suggestion.status !== "proposed") return;

  if (suggestion.type === "knowledge" && suggestion.question) {
    await createKnowledge(clientId, {
      question: suggestion.question,
      answer: suggestion.answer ?? "",
      source: "manual",
      isActive: true,
    });
  } else if (suggestion.type === "guidance" && suggestion.guidance) {
    const client = await getClientByIdUnsafe(clientId);
    const current = client?.agentGuidance?.trim() ?? "";
    const next = current ? `${current}\n${suggestion.guidance}` : suggestion.guidance;
    await db.update(clients).set({ agentGuidance: next }).where(eq(clients.id, clientId));
  }

  await markSuggestion(clientId, suggestionId, "applied", user.id);
  await applyClientEdit(user, clientId);
  revalidatePath("/portal");
}

export async function dismissSuggestionAction(formData: FormData): Promise<void> {
  const clientId = String(formData.get("clientId") ?? "");
  const suggestionId = String(formData.get("suggestionId") ?? "");
  const guard = await requireClientEditor(clientId);
  if (!guard.ok) return; // locked staff: silent no-op (banner explains)
  const user = guard.user;
  await assertClientInOrg(user.orgId, clientId);
  await markSuggestion(clientId, suggestionId, "dismissed", user.id);
  revalidatePath("/portal");
}
