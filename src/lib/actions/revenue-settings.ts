"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { audit } from "@/lib/data/audit";
import { assertClientAccess } from "@/lib/auth-guard";
import { assertClientInOrg } from "@/lib/data/clients";
import { planAccessFor, UPGRADE_MESSAGES } from "@/lib/plan-access";
import { templateProblem } from "@/lib/revenue-texts";
import { clampMonths, monthsLabel } from "@/lib/winback";
import { type ActionState } from "./types";

/**
 * Settings for the Pro revenue texts. The plan is checked HERE, on the server:
 * a Starter business can't switch one on by posting the form by hand. Turning
 * one OFF is always allowed, whatever the plan.
 */
export async function saveWinbackSettingsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const enabled = String(formData.get("enabled") ?? "") === "on";
  const months = clampMonths(formData.get("months"));
  const template = String(formData.get("template") ?? "").trim();

  const user = await assertClientAccess(clientId);
  if (user.role !== "operator" && user.role !== "client_admin") {
    return { ok: false, error: "Only your account admin can change this." };
  }
  const client = await assertClientInOrg(user.orgId, clientId);

  if (enabled) {
    const access = await planAccessFor(client);
    if (!access.has("winback")) return { ok: false, error: UPGRADE_MESSAGES.winback };
  }
  const problem = templateProblem(template);
  if (problem) return { ok: false, fieldErrors: { template: [problem] } };

  const patch = JSON.stringify({ enabled, months, template: template || null });
  await db
    .update(clients)
    .set({
      setupFlags: sql`jsonb_set(coalesce(${clients.setupFlags}, '{}'::jsonb), '{winback}',
        coalesce(${clients.setupFlags} -> 'winback', '{}'::jsonb) || ${patch}::jsonb, true)`,
    })
    .where(eq(clients.id, clientId));
  void audit({ clientId, actor: user.id, action: "settings.winback", detail: { enabled, months } });
  revalidatePath("/portal/settings", "layout");
  revalidatePath("/portal");
  return {
    ok: true,
    message: enabled
      ? `On. Once a month, past customers who haven't been back in ${monthsLabel(months)} get one text.`
      : "Off. No win-back texts will be sent.",
  };
}
