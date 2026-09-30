"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { verifyIntakeToken } from "@/lib/intake-token";
import { tidyBusinessName, toE164 } from "@/lib/format";
import { getClientByIdUnsafe, updateClient } from "@/lib/data/clients";
import { applyWebsiteToClient } from "@/lib/onboarding-apply";
import { applyClientEdit } from "@/lib/agent-publish";
import { consumeAttempt } from "@/lib/rate-limit";
import { countDraftableContent } from "@/lib/data/intake";
import { logger } from "@/lib/logger";
import { type ActionState, fieldErrorsOf } from "./types";

/**
 * Same limits as the portal forms (validation.ts). The intake page is public —
 * the link IS the authorization — so nothing here may be longer than what an
 * owner could type in Settings. `instructions` becomes the agent's guidance.
 */
const intakeSchema = z.object({
  name: z.string().trim().min(1, "Business name is required").max(120),
  // "brightsmile.com" is what people type; accept it (same as signup).
  websiteUrl: z
    .string()
    .trim()
    .max(300)
    .transform((v) => (v && !/^https?:\/\//i.test(v) ? `https://${v}` : v))
    .pipe(z.string().url("Enter your website, like yourbusiness.com").or(z.literal(""))),
  ownerEmail: z.string().trim().max(254).email("Enter a valid email").or(z.literal("")),
  ownerCell: z.string().trim().max(40),
  instructions: z.string().trim().max(4000, "Keep this under 4,000 characters"),
});

/** Submissions per link per window. Generous for a real owner fixing a typo. */
const INTAKE_LIMIT = 6;
const INTAKE_WINDOW_MS = 60 * 60_000;

function echo(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ["name", "websiteUrl", "ownerEmail", "ownerCell", "instructions"]) {
    out[k] = String(formData.get(k) ?? "").slice(0, 4000);
  }
  return out;
}

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

  // Every submit can re-read a website through a paid model, and the link is
  // shareable. A leaked link shouldn't be a free scraping/LLM endpoint.
  const gate = consumeAttempt(`intake:${clientId}`, INTAKE_LIMIT, INTAKE_WINDOW_MS);
  if (!gate.ok) {
    logger.warn("intake.throttled", { clientId });
    return {
      ok: false,
      error: "Too many submissions from this link. Wait a little and try again, or reply to whoever sent it.",
      data: { values: echo(formData) },
    };
  }

  const parsed = intakeSchema.safeParse({
    name: formData.get("name") ?? "",
    websiteUrl: formData.get("websiteUrl") ?? "",
    ownerEmail: formData.get("ownerEmail") ?? "",
    ownerCell: formData.get("ownerCell") ?? "",
    instructions: formData.get("instructions") ?? "",
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsOf(parsed.error), data: { values: echo(formData) } };
  }
  const d = parsed.data;

  // A blank or unparseable cell used to write null straight over a working
  // escalation number — which turns off transfers to a person, strips the
  // callback number out of every confirmation text, and disarms the emergency
  // handoff. A form left blank should change nothing; a form filled in wrong
  // should say so. Same for the other two: blank means "unchanged", not "erase".
  const escalationNumber = d.ownerCell ? toE164(d.ownerCell) : null;
  if (d.ownerCell && !escalationNumber) {
    return {
      ok: false,
      fieldErrors: { ownerCell: ["Enter a 10-digit US mobile number"] },
      data: { values: echo(formData) },
    };
  }

  const name = tidyBusinessName(d.name);
  await updateClient(client.orgId, clientId, {
    name,
    websiteUrl: d.websiteUrl || client.websiteUrl,
    ownerEmail: d.ownerEmail || client.ownerEmail,
    escalationNumber: escalationNumber ?? client.escalationNumber,
    agentGuidance: d.instructions || client.agentGuidance,
  });

  // Draft from the website only while there's nothing to overwrite or
  // duplicate. Each submit used to re-add every drafted service and FAQ, so a
  // second submit doubled them, and it re-ran the paid scrape each time.
  let drafting = false;
  if (d.websiteUrl && (await countDraftableContent(clientId)) === 0) {
    drafting = true;
    await applyWebsiteToClient(client.orgId, clientId, name, d.websiteUrl);
  }

  // The new name, alert number and guidance used to wait for the next
  // unrelated edit to reach a live agent. Push them now (no-op before activation).
  await applyClientEdit({ orgId: client.orgId }, clientId);

  revalidatePath(`/clients/${clientId}`);
  return { ok: true, data: { drafting } };
}
