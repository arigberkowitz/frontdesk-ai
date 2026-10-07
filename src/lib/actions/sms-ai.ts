"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { assertClientAccess, getCurrentDbUser, resolvePortalClient } from "@/lib/auth-guard";
import { assertClientInOrg } from "@/lib/data/clients";
import { getConversationSummary } from "@/lib/data/sms-messages";
import { setThreadAiPaused } from "@/lib/data/sms-threads";
import { audit } from "@/lib/data/audit";
import { parseThreadParam } from "@/lib/sms-inbox-view";
import { clampPauseHours } from "@/lib/sms-ai/rules";
import { logger } from "@/lib/logger";
import { type ActionState } from "./types";

/**
 * Settings → Follow-ups → "AI text replies". Owner/admin only, like the other
 * switches that text customers unattended. Off by default.
 */
export async function saveAiTextRepliesSettingsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const enabled = String(formData.get("enabled") ?? "") === "on";
  const pauseHours = clampPauseHours(formData.get("pauseHours"));

  const user = await assertClientAccess(clientId);
  if (user.role !== "operator" && user.role !== "client_admin") {
    return { ok: false, error: "Only your account admin can change this." };
  }
  await assertClientInOrg(user.orgId, clientId);

  await db
    .update(clients)
    .set({ aiTextRepliesEnabled: enabled, aiTextPauseHours: pauseHours })
    .where(eq(clients.id, clientId));
  void audit({ clientId, actor: user.id, action: "settings.ai_text_replies", detail: { enabled, pauseHours } });
  revalidatePath("/portal/settings", "layout");
  // The Overview's "AI features" switchboard shows this switch too.
  revalidatePath("/portal");
  return {
    ok: true,
    message: enabled
      ? `On. Your AI will answer customer texts, and hands anything it isn't sure about to you. It stays quiet for ${pauseHours} hours in a conversation after you reply yourself.`
      : "Off. Customer texts come to you, as before.",
  };
}

/**
 * Messages → conversation → "Pause AI" / "Resume AI". The business comes from
 * the session, never the form; the thread must exist for that business. Staff
 * may use it (it only ever makes the AI do less, or puts back what the owner
 * turned on). An operator previewing the portal may not.
 */
export async function setThreadAiAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const phone = parseThreadParam(String(formData.get("phone") ?? ""));
  if (!phone) return { ok: false, error: "Conversation not found." };
  const mode = String(formData.get("mode") ?? "");
  if (mode !== "pause" && mode !== "resume") return { ok: false, error: "Unknown action." };

  const { clientId, preview } = await resolvePortalClient();
  if (preview) {
    return { ok: false, error: "You're previewing this business's portal — only the business can change this." };
  }
  try {
    const summary = await getConversationSummary(clientId, phone);
    if (summary.total === 0) return { ok: false, error: "Conversation not found." };
    await setThreadAiPaused(clientId, phone, mode === "pause", mode === "pause" ? "owner" : null);
  } catch (err) {
    logger.error("messages.ai_toggle_failed", {
      clientId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: "Couldn't change that right now — please try again." };
  }
  const user = await getCurrentDbUser();
  void audit({ clientId, actor: user.id, action: `sms_ai.thread_${mode}`, detail: { phone } });
  revalidatePath(`/portal/messages/${phone}`);
  return {
    ok: true,
    message: mode === "pause" ? "AI replies paused in this conversation." : "AI replies resumed in this conversation.",
  };
}
