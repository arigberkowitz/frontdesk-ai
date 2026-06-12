import "server-only";
import { updateClient } from "@/lib/data/clients";
import { createService } from "@/lib/data/services";
import { setWeekHours, type DayHoursInput } from "@/lib/data/hours";
import { createKnowledge } from "@/lib/data/knowledge";
import { scrapeWebsite } from "@/lib/scrape";
import { dayNameToIndex, structureBusinessProfile, type StructuredProfile } from "@/lib/onboarding";
import { logger } from "@/lib/logger";

/** Merge an AI-structured profile into a client (§8 step 4). */
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
 * Scrape a website, structure it with Claude, and populate the client's
 * services / hours / FAQ. Best-effort: a bad site or a missing Anthropic key is
 * swallowed (logged) so the rest of onboarding still succeeds.
 */
export async function applyWebsiteToClient(
  orgId: string,
  clientId: string,
  name: string,
  websiteUrl: string,
): Promise<void> {
  try {
    const scraped = await scrapeWebsite(websiteUrl);
    const profile = await structureBusinessProfile(name, scraped.combinedText);
    if (profile) {
      await applyProfile(orgId, clientId, profile);
      logger.info("onboard.structured", {
        clientId,
        services: profile.services.length,
        faq: profile.faq.length,
      });
    }
  } catch (err) {
    logger.error("onboard.failed", {
      clientId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
