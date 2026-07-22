"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOperator } from "@/lib/auth-guard";
import { createClient } from "@/lib/data/clients";
import { applyWebsiteToClient } from "@/lib/onboarding-apply";
import { DEFAULT_TIMEZONE } from "@/config/app";
import { type ActionState, fieldErrorsOf } from "./types";

const onboardSchema = z.object({
  name: z.string().trim().min(1, "Business name is required").max(120),
  // No website is a first-class path (plenty of local businesses have none) —
  // they set up services/hours/FAQ by hand in the portal instead.
  websiteUrl: z
    .string()
    .trim()
    .url("Enter a valid URL (including https://)")
    .or(z.literal(""))
    .transform((v) => v || null),
});

/** Create a draft client; when a website is given, draft services/hours/FAQ from it. */
async function runWebsiteOnboard(
  orgId: string,
  name: string,
  websiteUrl: string | null,
): Promise<string> {
  const client = await createClient(orgId, { name, websiteUrl, timezone: DEFAULT_TIMEZONE });
  if (websiteUrl) await applyWebsiteToClient(orgId, client.id, name, websiteUrl);
  return client.id;
}

/**
 * Operator dashboard: onboard from a website, then go to the client detail page
 * to review before provisioning (human-in-the-loop, §8 step 5).
 */
export async function onboardFromWebsiteAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireOperator();
  const parsed = onboardSchema.safeParse({
    name: formData.get("name"),
    websiteUrl: formData.get("websiteUrl"),
  });
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };

  const clientId = await runWebsiteOnboard(user.orgId, parsed.data.name, parsed.data.websiteUrl);
  revalidatePath("/clients");
  redirect(`/clients/${clientId}?onboarded=1`);
}

/**
 * Self-serve signup: a business owner drafts their own receptionist from their
 * website, then lands in their portal to review the drafted services/hours/FAQ.
 */
export async function onboardFromWebsitePortalAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireOperator();
  const parsed = onboardSchema.safeParse({
    name: formData.get("name"),
    websiteUrl: formData.get("websiteUrl"),
  });
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };

  await runWebsiteOnboard(user.orgId, parsed.data.name, parsed.data.websiteUrl);
  revalidatePath("/portal", "layout");
  redirect("/portal?onboarded=1");
}
