"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { attachCreatorToClient, requireBusinessCreator, requireOperator } from "@/lib/auth-guard";
import { createClient } from "@/lib/data/clients";
import { applyWebsiteToClient } from "@/lib/onboarding-apply";
import { finishSignup } from "@/lib/signup";
import { safeIndustry } from "@/config/starter-packs";
import { DEFAULT_TIMEZONE } from "@/config/app";
import { type ActionState, fieldErrorsOf } from "./types";

const onboardSchema = z.object({
  name: z.string().trim().min(1, "Business name is required").max(120),
  // No website is a first-class path (plenty of local businesses have none) —
  // they set up services/hours/FAQ by hand in the portal instead.
  // "brightsmile.com" is what a business owner types; requiring the scheme
  // rejected the most natural possible input with a lecture about https://.
  websiteUrl: z
    .string()
    .trim()
    .transform((v) => (v && !/^https?:\/\//i.test(v) ? `https://${v}` : v))
    .pipe(z.string().url("Enter your website, like yourbusiness.com").or(z.literal("")))
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
): Promise<{ clientId: string; drafted: boolean }> {
  const client = await createClient(orgId, { name, websiteUrl, timezone });
  const drafted = websiteUrl
    ? await applyWebsiteToClient(orgId, client.id, name, websiteUrl)
    : false;
  return { clientId: client.id, drafted };
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

  const { clientId } = await runWebsiteOnboard(
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

  const { clientId, drafted } = await runWebsiteOnboard(
    user.orgId,
    parsed.data.name,
    parsed.data.websiteUrl,
    safeTimezone(formData.get("timezone")),
  );
  await attachCreatorToClient(user, clientId);

  // Setup profile: teams start with per-person booking ready to go.
  const sizeRaw = String(formData.get("companySize") ?? "solo");
  const companySize = ["solo", "team", "big"].includes(sizeRaw) ? sizeRaw : "solo";
  const industry = safeIndustry(formData.get("industry"));
  // Which pricing card brought them here, so checkout opens on that plan
  // instead of making them choose a second time.
  const wanted = String(formData.get("plan") ?? "").trim();
  const intendedPlan = ["backup", "starter", "pro"].includes(wanted) ? wanted : undefined;

  // Trial, starter pack when the website drafted nothing, the receptionist
  // and its number, the welcome email — the same finish as the template path.
  //
  // The pack used to run only when no website was given, so the owner who did
  // the MORE thorough thing — pasted their URL — was the one who could end up
  // with nothing: a site that's all JavaScript, or behind a bot wall, drafts
  // into silence, and the pack also carries the industry's safety guardrails.
  await finishSignup(user, clientId, { industry, seedFromPack: !drafted, intendedPlan, companySize });

  revalidatePath("/portal", "layout");
  // Say which of the two things actually happened. The banner on the other end
  // used to claim the website draft unconditionally, including to people who
  // never entered one.
  redirect(`/portal?onboarded=${drafted ? "website" : "template"}`);
}
