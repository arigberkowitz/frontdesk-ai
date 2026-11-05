"use server";

import { revalidatePath } from "next/cache";
import { requireClientOwner } from "@/lib/auth-guard";
import { audit } from "@/lib/data/audit";
import { detailsFromForm } from "@/lib/tollfree/details";
import { liveTollfreeDeps } from "@/lib/tollfree/deps";
import { saveTollfreeDetails } from "@/lib/tollfree/service";
import { type ActionState } from "./types";

/**
 * Settings → Phone & AI → Texting: save the business's verification details
 * and submit (or resubmit) them. Owner-only: it's the business's legal
 * identity and EIN, not an AI setting the edit code unlocks.
 */
export async function saveTollfreeDetailsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const guard = await requireClientOwner(clientId);
  if (!guard.ok) return { ok: false, error: guard.error };
  const result = await saveTollfreeDetails(liveTollfreeDeps(), clientId, detailsFromForm(formData));
  if (!result.ok) return { ok: false, error: result.error, fieldErrors: result.fieldErrors };
  // Never log the EIN or contact details.
  void audit({ clientId, actor: guard.user.id, action: "tollfree.details_saved", detail: { state: result.state } });
  revalidatePath("/portal/settings/phone");
  return {
    ok: true,
    message:
      result.state === "needs_number"
        ? "Saved. We'll submit them as soon as your texting number is ready."
        : "Submitted. Carriers usually take 3–5 business days.",
  };
}
