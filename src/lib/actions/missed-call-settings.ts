"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { audit } from "@/lib/data/audit";
import { assertClientAccess } from "@/lib/auth-guard";
import { assertClientInOrg } from "@/lib/data/clients";
import { env } from "@/lib/env";
import { type ActionState } from "./types";

/**
 * Missed-call text-back on/off, plus the separate AI phone-callback switch.
 * Both default off; only the account admin (or operator) can turn them on,
 * because these messages leave on the business's number, unattended, to
 * people who didn't ask for them. The AI-call switch is inert unless the
 * platform has MISSED_CALL_AI_CALLBACKS=on, and is never saved as on otherwise.
 */
export async function saveMissedCallSettingsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const enabled = String(formData.get("enabled") ?? "") === "on";
  const aiCallRequested = String(formData.get("aiCallbacks") ?? "") === "on";

  const user = await assertClientAccess(clientId);
  if (user.role !== "operator" && user.role !== "client_admin") {
    return { ok: false, error: "Only your account admin can change this." };
  }
  await assertClientInOrg(user.orgId, clientId);

  // A phone call is a bigger step than a text, so it rides on top of texts
  // being on, and only where the platform switch allows it at all.
  const aiCallbacks = enabled && aiCallRequested && env.MISSED_CALL_AI_CALLBACKS;

  await db
    .update(clients)
    .set({ missedCallTextsEnabled: enabled, missedCallAiCallbacksEnabled: aiCallbacks })
    .where(eq(clients.id, clientId));

  void audit({
    clientId,
    actor: user.id,
    action: "settings.missed_call_callbacks",
    detail: { enabled, aiCallbacks },
  });
  revalidatePath("/portal/settings", "layout");
  return {
    ok: true,
    message: !enabled
      ? "Off. Nobody will be texted after a missed or dropped call."
      : aiCallbacks
        ? "On. Your AI will call back missed callers (or text if it can't)."
        : "On. Missed and dropped callers get a text offering to finish booking.",
  };
}
