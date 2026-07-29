"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { assertClientEditor } from "@/lib/auth-guard";
import { assertClientInOrg } from "@/lib/data/clients";
import { getClientSetupStatus } from "@/lib/data/setup";
import { checkSetupReadiness } from "@/lib/agents/setup-check";
import { logger } from "@/lib/logger";
import { type ActionState } from "./types";

/**
 * Owner says "I'm done" → re-derive the checklist, run the AI readiness check,
 * and only then mark setup complete (hides the overview checklist; it stays
 * available under Settings → Setup).
 */
export async function finishSetupAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const user = await assertClientEditor(clientId);
  await assertClientInOrg(user.orgId, clientId);

  const status = await getClientSetupStatus(clientId);
  const missing = status.steps.filter((s) => !s.done);
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Not quite — still open: ${missing.map((s) => s.label.toLowerCase()).join(", ")}.`,
    };
  }

  const check = await checkSetupReadiness(clientId);
  if (!check.ready && check.issues.length > 0) {
    return {
      ok: false,
      error: `The AI reviewer found a few things to fix first: ${check.issues.join(" · ")}`,
    };
  }

  await db.update(clients).set({ setupCompletedAt: new Date() }).where(eq(clients.id, clientId));
  logger.info("setup.finished", { clientId, aiChecked: check.checked });
  revalidatePath("/portal", "layout");
  return {
    ok: true,
    message: check.checked
      ? "Setup complete — the AI reviewed everything and you're ready for live calls. You can revisit setup anytime under Settings."
      : "Setup complete — you're ready for live calls. You can revisit setup anytime under Settings.",
  };
}

/** Reopen the checklist on the overview (from Settings → Setup). */
export async function reopenSetupAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const user = await assertClientEditor(clientId);
  await assertClientInOrg(user.orgId, clientId);

  await db.update(clients).set({ setupCompletedAt: null }).where(eq(clients.id, clientId));
  revalidatePath("/portal", "layout");
  return { ok: true, message: "Setup checklist reopened on your Overview." };
}
