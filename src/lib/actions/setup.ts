"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { requireClientEditor } from "@/lib/auth-guard";
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
  const guard = await requireClientEditor(clientId);
  if (!guard.ok) return { ok: false, error: guard.error };
  const user = guard.user;
  await assertClientInOrg(user.orgId, clientId);

  const status = await getClientSetupStatus(clientId);
  const missing = status.steps.filter((s) => !s.done);
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Not quite — still open: ${missing.map((s) => s.label.toLowerCase()).join(", ")}.`,
    };
  }

  // The reviewer's findings are ADVICE, not a gate. Every mechanical step is
  // done by this point — the AI has a number, hours, a calendar and a greeting,
  // and it will answer the phone correctly. "Your consultation has no price" is
  // worth knowing and worth ignoring; refusing to let someone finish over it
  // told them they'd failed when they'd actually succeeded.
  const check = await checkSetupReadiness(clientId);
  const notes = check.issues.slice(0, 6);

  const existing = await db.query.clients.findFirst({
    where: (c, { eq: e }) => e(c.id, clientId),
    columns: { setupFlags: true },
  });
  await db
    .update(clients)
    .set({
      setupCompletedAt: new Date(),
      setupFlags: { ...(existing?.setupFlags ?? {}), reviewNotes: notes },
    })
    .where(eq(clients.id, clientId));

  logger.info("setup.finished", { clientId, aiChecked: check.checked, notes: notes.length });
  revalidatePath("/portal", "layout");
  return {
    ok: true,
    message: notes.length
      ? `Setup complete — you're ready for live calls. The AI also left ${notes.length === 1 ? "a suggestion" : `${notes.length} suggestions`} below, none of them blocking.`
      : check.checked
        ? "Setup complete — the AI reviewed everything and you're ready for live calls. You can revisit setup anytime under Settings."
        : "Setup complete — you're ready for live calls. You can revisit setup anytime under Settings.",
  };
}

/** Manual checklist flags: skip calendar / confirm phone forwarding. */
export async function setSetupFlagAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const flag = String(formData.get("flag") ?? "");
  const value = String(formData.get("value") ?? "") === "true";
  const guard = await requireClientEditor(clientId);
  if (!guard.ok) return { ok: false, error: guard.error };
  const user = guard.user;
  await assertClientInOrg(user.orgId, clientId);
  if (flag !== "calendarSkipped" && flag !== "forwardingDone") {
    return { ok: false, error: "Unknown setting." };
  }

  const client = await db.query.clients.findFirst({
    where: eq(clients.id, clientId),
    columns: { setupFlags: true },
  });
  await db
    .update(clients)
    .set({ setupFlags: { ...(client?.setupFlags ?? {}), [flag]: value } })
    .where(eq(clients.id, clientId));
  revalidatePath("/portal", "layout");
  return {
    ok: true,
    message:
      flag === "calendarSkipped"
        ? value
          ? "Skipped for now — your AI takes messages instead of booking. Connect a calendar anytime to unlock live booking."
          : "Calendar step reopened."
        : value
          ? "Forwarding confirmed — calls to your business line now reach your AI."
          : "Forwarding step reopened.",
  };
}

/** Reopen the checklist on the overview (from Settings → Setup). */
export async function reopenSetupAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const guard = await requireClientEditor(clientId);
  if (!guard.ok) return { ok: false, error: guard.error };
  const user = guard.user;
  await assertClientInOrg(user.orgId, clientId);

  await db.update(clients).set({ setupCompletedAt: null }).where(eq(clients.id, clientId));
  revalidatePath("/portal", "layout");
  return { ok: true, message: "Setup checklist reopened on your Overview." };
}

/**
 * Clear the AI's setup suggestions. They're optional by definition, so a
 * business that has read them and decided otherwise should be able to put them
 * away for good rather than living with a permanent nag.
 */
export async function dismissReviewNotesAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const guard = await requireClientEditor(clientId);
  if (!guard.ok) return { ok: false, error: guard.error };
  await assertClientInOrg(guard.user.orgId, clientId);

  const existing = await db.query.clients.findFirst({
    where: (c, { eq: e }) => e(c.id, clientId),
    columns: { setupFlags: true },
  });
  await db
    .update(clients)
    .set({ setupFlags: { ...(existing?.setupFlags ?? {}), reviewNotes: [] } })
    .where(eq(clients.id, clientId));

  revalidatePath("/portal", "layout");
  return { ok: true, message: "Dismissed." };
}
