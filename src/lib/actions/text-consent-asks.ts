"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { assertClientAccess } from "@/lib/auth-guard";
import { assertClientInOrg } from "@/lib/data/clients";
import { audit } from "@/lib/data/audit";
import { applyClientEdit, withSyncNote } from "@/lib/agent-publish";
import { parseTextConsentAsks } from "@/lib/text-consent-asks";
import { type ActionState } from "./types";

/**
 * Settings → Follow-ups → "Ask callers about texts": the two owner switches
 * for the follow-up ask (win-back, reviews, recall) and the message ask
 * (texts about a message, missed-call text-back). Both default OFF. Only the
 * account admin (or an operator) can change them, because they change what
 * the AI says on every call. A change republishes the live agent so the phone
 * line matches the switch.
 */
export async function saveTextConsentAsksAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const followup = String(formData.get("followup") ?? "") === "on";
  const message = String(formData.get("message") ?? "") === "on";

  const user = await assertClientAccess(clientId);
  if (user.role !== "operator" && user.role !== "client_admin") {
    return { ok: false, error: "Only your account admin can change this." };
  }
  const client = await assertClientInOrg(user.orgId, clientId);
  const before = parseTextConsentAsks(client.setupFlags);

  await db
    .update(clients)
    .set({
      setupFlags: sql`coalesce(${clients.setupFlags}, '{}'::jsonb) || ${JSON.stringify({ textConsentAsks: { followup, message } })}::jsonb` as unknown as (typeof clients.$inferInsert)["setupFlags"],
    })
    .where(eq(clients.id, clientId));

  void audit({
    clientId,
    actor: user.id,
    action: "settings.text_consent_asks",
    detail: { followup, message, wasFollowup: before.followup, wasMessage: before.message },
  });

  revalidatePath("/portal/settings", "layout");
  revalidatePath(`/clients/${clientId}`);

  const parts = [
    followup ? "Your AI now asks callers who book if they'd like follow-up texts." : "Your AI doesn't ask for follow-up texts.",
    message ? "It asks callers who leave a message if it can text them." : "It doesn't ask message callers about texts.",
  ];
  if (before.followup === followup && before.message === message) return { ok: true, message: "Saved." };
  const sync = await applyClientEdit(user, clientId);
  return { ok: true, message: withSyncNote(parts.join(" "), sync) };
}
