"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { requireClientOwner } from "@/lib/auth-guard";
import { assertClientInOrg } from "@/lib/data/clients";
import { type ActionState } from "./types";

/**
 * Owner opts in (or back out) of the "3 days left" trial reminder email.
 * Off unless they ask for it; the daily retention cron sends it (lifecycle.ts).
 */
export async function setTrialReminderAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const on = String(formData.get("on") ?? "") === "true";
  const guard = await requireClientOwner(clientId);
  if (!guard.ok) return { ok: false, error: guard.error };
  await assertClientInOrg(guard.user.orgId, clientId);

  const existing = await db.query.clients.findFirst({
    where: eq(clients.id, clientId),
    columns: { setupFlags: true },
  });
  await db
    .update(clients)
    .set({ setupFlags: { ...(existing?.setupFlags ?? {}), trialReminderOptIn: on } })
    .where(eq(clients.id, clientId));
  revalidatePath("/portal", "layout");
  return {
    ok: true,
    message: on
      ? "Done — we'll email you 3 days before your trial ends."
      : "Reminder off. The banner here still counts down.",
  };
}
