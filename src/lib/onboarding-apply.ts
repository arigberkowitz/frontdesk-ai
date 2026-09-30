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
import { usableDayHours } from "@/lib/hours-util";
import { toE164 } from "@/lib/format";

const MAX_DRAFTED_ITEMS = 40;

/** Merge an AI-structured profile into a client (§8 step 4). */
async function applyProfile(
  orgId: string,
  clientId: string,
  profile: StructuredProfile,
): Promise<void> {
  await updateClient(orgId, clientId, {
    address: profile.address.trim().slice(0, 300) || null,
    // Drafted from a web page, so normalize it like every other phone field
    // (the forwarding instructions quote it back to the owner).
    forwardingNumber: toE164(profile.phone.trim()) ?? null,
  });

  // Same limits as the manual forms (validation.ts). This text comes from a
  // web page anyone can point us at and ends up in the agent's prompt, so it
  // doesn't get to be longer or more numerous than what an owner could type.
  for (const s of profile.services.slice(0, MAX_DRAFTED_ITEMS)) {
    if (!s.name.trim()) continue;
    await createService(clientId, {
      name: s.name.trim().slice(0, 120),
      durationMin: s.durationMin,
      priceCents: s.priceDollars > 0 ? Math.round(s.priceDollars * 100) : null,
      description: s.description.trim().slice(0, 2000) || null,
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
  // Model output, so hold it to the same rules as the hours form: a row with
  // "9am" or close-before-open is dropped (the owner fills it in) rather than
  // saved into the booking window and the agent's prompt.
  const usable = usableDayHours(days);
  if (usable.length) await setWeekHours(clientId, usable);

  for (const f of profile.faq.slice(0, MAX_DRAFTED_ITEMS)) {
    if (!f.question.trim() || !f.answer.trim()) continue;
    await createKnowledge(clientId, {
      question: f.question.trim().slice(0, 500),
      answer: f.answer.trim().slice(0, 4000),
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
          ...(client.greeting?.trim() ? {} : { greeting: voice.greeting.slice(0, 1000) }),
          ...(client.agentGuidance?.trim() || !voice.guidance
            ? {}
            : { agentGuidance: voice.guidance.slice(0, 4000) }),
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
