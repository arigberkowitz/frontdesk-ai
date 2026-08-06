import "server-only";
import { getClientByIdUnsafe, updateClient } from "@/lib/data/clients";
import { draftVoiceIdentity, verifyProfile } from "@/lib/agents/onboard-verify";
import { DEFAULT_AGENT_NAME } from "@/lib/prompt";
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
 * Agent #4 — autonomous onboarding. Crawl the site, structure it with Claude,
 * fact-check the draft against the source (verify pass strips anything the site
 * doesn't support), populate services / hours / FAQ, and draft a tone-matched
 * greeting + guidance so the receptionist arrives opinionated, not generic.
 * Best-effort: a bad site or a missing Anthropic key is swallowed (logged) so
 * the rest of onboarding still succeeds. Nothing goes live until the owner
 * reviews and activates.
 */
export async function applyWebsiteToClient(
  orgId: string,
  clientId: string,
  name: string,
  websiteUrl: string,
): Promise<boolean> {
  try {
    const scraped = await scrapeWebsite(websiteUrl);
    const draft = await structureBusinessProfile(name, scraped.combinedText);
    if (!draft) return false;

    const { profile, verified } = await verifyProfile(draft, scraped.combinedText);
    await applyProfile(orgId, clientId, profile);

    // Voice identity: only fill fields the owner hasn't already set.
    const client = await getClientByIdUnsafe(clientId);
    if (client && (!client.greeting?.trim() || !client.agentGuidance?.trim())) {
      const voice = await draftVoiceIdentity(
        name,
        client.agentName?.trim() || DEFAULT_AGENT_NAME,
        profile,
      );
      if (voice) {
        await updateClient(orgId, clientId, {
          ...(client.greeting?.trim() ? {} : { greeting: voice.greeting }),
          ...(client.agentGuidance?.trim() || !voice.guidance
            ? {}
            : { agentGuidance: voice.guidance }),
        });
      }
    }

    logger.info("onboard.structured", {
      clientId,
      verified,
      services: profile.services.length,
      faq: profile.faq.length,
    });
    // Nothing usable came back is not the same as success. A site that's all
    // JavaScript, or behind a bot wall, structures into an empty profile —
    // which used to leave the owner with an entirely blank portal under a
    // banner reading "We drafted your receptionist from your website."
    return profile.services.length > 0 || profile.faq.length > 0;
  } catch (err) {
    logger.error("onboard.failed", {
      clientId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
