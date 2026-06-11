"use server";

import { revalidatePath } from "next/cache";
import { assertClientAccess } from "@/lib/auth-guard";
import { assertClientInOrg } from "@/lib/data/clients";
import { updateLeadStatus } from "@/lib/data/leads";
import type { Lead } from "@/db/schema";
import { type ActionState } from "./types";

const STATUSES = ["new", "contacted", "won", "lost"] as const;

/** Update a captured message's follow-up status (operator or the client's own portal). */
export async function setLeadStatusAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const leadId = String(formData.get("leadId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) {
    return { ok: false, error: "Invalid status." };
  }

  const user = await assertClientAccess(clientId);
  await assertClientInOrg(user.orgId, clientId);
  await updateLeadStatus(clientId, leadId, status as Lead["status"]);

  revalidatePath("/portal", "layout");
  revalidatePath("/portal/leads");
  revalidatePath(`/clients/${clientId}`);
  return { ok: true };
}
