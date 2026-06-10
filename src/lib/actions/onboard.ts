"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOperator } from "@/lib/auth-guard";
import { createClient, updateClient } from "@/lib/data/clients";
import { createService } from "@/lib/data/services";
import { setWeekHours, type DayHoursInput } from "@/lib/data/hours";
import { createKnowledge } from "@/lib/data/knowledge";
import { scrapeWebsite } from "@/lib/scrape";
import { dayNameToIndex, structureBusinessProfile, type StructuredProfile } from "@/lib/onboarding";
import { DEFAULT_TIMEZONE } from "@/config/app";
import { logger } from "@/lib/logger";
import { type ActionState, fieldErrorsOf } from "./types";

const onboardSchema = z.object({
  name: z.string().trim().min(1, "Business name is required").max(120),
  websiteUrl: z.string().trim().url("Enter a valid URL (including https://)"),
});

/** Merge the AI-structured profile into the draft client (§8 step 4). */
async function applyProfile(
  orgId: string,
  clientId: string,
  profile: StructuredProfile,
): Promise<void> {
  await updateClient(orgId, clientId, {
    address: profile.address.trim() || null,
    forwardingNumber: profile.phone.trim() || null,
  });

  for (const s of profile.services) {
    if (!s.name.trim()) continue;
    await createService(clientId, {
      name: s.name.trim(),
      durationMin: s.durationMin,
      priceCents: s.priceDollars > 0 ? Math.round(s.priceDollars * 100) : null,
      description: s.description.trim() || null,
      isActive: true,
    });
  }

  const days: DayHoursInput[] = [];
  for (const h of profile.hours) {
    const dayOfWeek = dayNameToIndex(h.day);
    if (dayOfWeek < 0) continue;
    days.push({
      dayOfWeek,
      isClosed: h.closed,
      openTime: h.closed ? null : h.open.trim() || null,
      closeTime: h.closed ? null : h.close.trim() || null,
    });
  }
  if (days.length) await setWeekHours(clientId, days);

  for (const f of profile.faq) {
    if (!f.question.trim() || !f.answer.trim()) continue;
    await createKnowledge(clientId, {
      question: f.question.trim(),
      answer: f.answer.trim(),
      source: "scraped",
      isActive: true,
    });
  }
}

/**
 * Onboard from a website: create a draft client, scrape the site, structure it
 * with Claude, and populate services/hours/FAQ — then send the operator to the
 * detail page to review before provisioning (human-in-the-loop, §8 step 5).
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

  const { name, websiteUrl } = parsed.data;
  // Create the draft first so a scrape failure still leaves a usable client.
  const client = await createClient(user.orgId, {
    name,
    websiteUrl,
    timezone: DEFAULT_TIMEZONE,
  });

  try {
    const scraped = await scrapeWebsite(websiteUrl);
    const profile = await structureBusinessProfile(name, scraped.combinedText);
    if (profile) {
      await applyProfile(user.orgId, client.id, profile);
      logger.info("onboard.structured", {
        clientId: client.id,
        services: profile.services.length,
        faq: profile.faq.length,
      });
    }
  } catch (err) {
    logger.error("onboard.failed", {
      clientId: client.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  revalidatePath("/clients");
  redirect(`/clients/${client.id}?onboarded=1`);
}
