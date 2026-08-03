"use server";

import { revalidatePath } from "next/cache";
import { verifyIntakeToken } from "@/lib/intake-token";
import { toE164 } from "@/lib/format";
import { getClientByIdUnsafe, updateClient } from "@/lib/data/clients";
import { applyWebsiteToClient } from "@/lib/onboarding-apply";
import { type ActionState } from "./types";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Public client-intake submission. The signed token IS the authorization — it
 * scopes this submission to exactly one client, so there's no login. Saves the
 * contact details and, if a website is given, drafts services/hours/FAQ from it.
 */
export async function submitIntakeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const token = String(formData.get("token") ?? "");
  const clientId = verifyIntakeToken(token);
  if (!clientId) {
    return { ok: false, error: "This intake link is invalid or has expired — please ask for a new one." };
  }

  const client = await getClientByIdUnsafe(clientId);
  if (!client) return { ok: false, error: "This intake link is no longer valid." };

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, fieldErrors: { name: ["Business name is required"] } };

  const websiteUrl = String(formData.get("websiteUrl") ?? "").trim();
  const ownerEmail = String(formData.get("ownerEmail") ?? "").trim();
  if (ownerEmail && !EMAIL_RE.test(ownerEmail)) {
    return { ok: false, fieldErrors: { ownerEmail: ["Enter a valid email"] } };
  }
  const ownerCell = String(formData.get("ownerCell") ?? "").trim();
  const instructions = String(formData.get("instructions") ?? "").trim();

  await updateClient(client.orgId, clientId, {
    name,
    websiteUrl: websiteUrl || null,
    ownerEmail: ownerEmail || null,
    escalationNumber: toE164(ownerCell),
    agentGuidance: instructions || client.agentGuidance,
  });

  // Draft from the website if they gave one (best-effort; needs the Anthropic key).
  if (websiteUrl) {
    await applyWebsiteToClient(client.orgId, clientId, name, websiteUrl);
  }

  revalidatePath(`/clients/${clientId}`);
  return { ok: true };
}
