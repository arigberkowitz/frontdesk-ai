"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { attachCreatorToClient, requireBusinessCreator, requireOperator } from "@/lib/auth-guard";
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

/** Validate a browser-supplied IANA timezone; anything dodgy → platform default. */
function safeTimezone(raw: unknown): string {
  const tz = String(raw ?? "").trim();
  if (!tz || tz.length > 60) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/** Create a draft client; when a website is given, draft services/hours/FAQ from it. */
async function runWebsiteOnboard(
  orgId: string,
  name: string,
  websiteUrl: string | null,
  timezone: string,
): Promise<string> {
  const client = await createClient(orgId, { name, websiteUrl, timezone });
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

  const clientId = await runWebsiteOnboard(
    user.orgId,
    parsed.data.name,
    parsed.data.websiteUrl,
    safeTimezone(formData.get("timezone")),
  );
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
  const user = await requireBusinessCreator();
  const parsed = onboardSchema.safeParse({
    name: formData.get("name"),
    websiteUrl: formData.get("websiteUrl"),
  });
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };

  const clientId = await runWebsiteOnboard(
    user.orgId,
    parsed.data.name,
    parsed.data.websiteUrl,
    safeTimezone(formData.get("timezone")),
  );
  await attachCreatorToClient(user, clientId);

  // Setup profile: teams start with per-person booking ready to go.
  const sizeRaw = String(formData.get("companySize") ?? "solo");
  const companySize = ["solo", "team", "big"].includes(sizeRaw) ? sizeRaw : "solo";
  await db
    .update(clients)
    .set({ companySize, staffModeEnabled: companySize !== "solo" })
    .where(eq(clients.id, clientId));

  revalidatePath("/portal", "layout");
  redirect("/portal?onboarded=1");
}
