"use server";

import { requireClientEditor } from "@/lib/auth-guard";
import { getClient } from "@/lib/data/clients";
import { getBookingProviderForClient } from "@/lib/booking";
import { parseLanguages } from "@/lib/languages";
import { consumeAttempt, formatRetryAfter } from "@/lib/rate-limit";
import { buildDraft, isDraftField, type DraftFacts } from "@/lib/setup-draft";
import { logger } from "@/lib/logger";

export type SetupDraftResult =
  | { ok: true; text: string; note: string }
  | { ok: false; error: string };

/** Plenty for someone clicking around setup; stops a script from hammering the database. */
const LIMIT = 40;
const WINDOW_MS = 10 * 60_000;

/**
 * "Fill in for me": a starting draft for one setup text box, written from what
 * this business has already set up (see `lib/setup-draft.ts`).
 *
 * Read-only. It saves nothing, so the owner can edit the text and it only goes
 * live when they press that box's Save. Same access rule as saving: owners and
 * operators, and staff only with the edit code unlocked.
 */
export async function draftSetupTextAction(input: {
  clientId: string;
  field: string;
  serviceName?: string;
}): Promise<SetupDraftResult> {
  const clientId = String(input?.clientId ?? "");
  if (!isDraftField(input?.field)) return { ok: false, error: "That box can't be filled in." };

  const guard = await requireClientEditor(clientId);
  if (!guard.ok) return { ok: false, error: guard.error };
  const user = guard.user;

  const limit = consumeAttempt(`setup-draft:${user.id}`, LIMIT, WINDOW_MS);
  if (!limit.ok) {
    return {
      ok: false,
      error: `That's a lot of suggestions. Try again in ${formatRetryAfter(limit.retryAfterSec)}.`,
    };
  }

  try {
    const client = await getClient(user.orgId, clientId);
    if (!client) return { ok: false, error: "Business not found." };

    const facts: DraftFacts = {
      businessName: client.name,
      agentName: client.agentName,
      industry: client.industry,
      services: client.services
        .filter((s) => s.isActive)
        .map((s) => ({ name: s.name, priceCents: s.priceCents })),
      hours: client.businessHours.map((h) => ({
        dayOfWeek: h.dayOfWeek,
        isClosed: h.isClosed,
        openTime: h.openTime,
        closeTime: h.closeTime,
      })),
      calendarConnected: getBookingProviderForClient(client).isConfigured(),
      languages: parseLanguages(client.languages),
      canTransfer: Boolean(client.escalationNumber?.trim()),
      handoffMode: client.setupFlags?.handoffMode ?? "always",
      humanHandoffEnabled: client.humanHandoffEnabled !== false,
    };
    const serviceName =
      typeof input.serviceName === "string" ? input.serviceName.slice(0, 120) : undefined;
    return buildDraft(input.field, facts, { serviceName });
  } catch (err) {
    logger.warn("setup_draft.failed", {
      clientId,
      field: input.field,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: "We couldn't write a suggestion just now. Try again in a moment." };
  }
}
