import "server-only";
import { revalidatePath } from "next/cache";
import { getClient, type ClientWithRelations } from "@/lib/data/clients";
import { getBookingProviderForClient } from "@/lib/booking";
import {
  buildGeneralPrompt,
  DEFAULT_AGENT_NAME,
  openHoursSummary,
  openingLine,
  withRequiredDisclosure,
} from "@/lib/prompt";
import { agentConversationSettings, agentSpeechSettings, buildAgentTools, getRetellClient } from "@/lib/retell";
import { env, integrations } from "@/lib/env";
import { logger } from "@/lib/logger";
import { planAccessFor } from "@/lib/plan-access";
import { quoteConsentAskOn } from "@/lib/revenue/quote-consent";
import { parseSettings as parseQuoteSettings } from "@/lib/revenue/quote-followup";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { clients, subscriptions } from "@/db/schema";
import { onBillingHold } from "@/lib/billing-hold";

/**
 * The live agent's tools, built from what this business has actually chosen.
 *
 * Every call site used to build these WITHOUT the handoff mode, so it silently
 * fell back to "always". A business could pick "never transfer" in Settings,
 * get a prompt that promised to take a message, and still be published with a
 * live transfer tool attached — the setting was half-wired, and the half that
 * was wrong is the half that rings somebody's phone at eleven at night.
 */
export function agentToolsFor(
  client: ClientWithRelations,
  clientId: string,
  opts: { quoteConsentAsk?: boolean } = {},
) {
  return buildAgentTools(
    env.APP_URL,
    clientId,
    client.escalationNumber,
    client.setupFlags?.handoffMode ?? "always",
    openHoursSummary(client.businessHours),
    client.waitlistEnabled,
    emergencyTransferFor(client),
    opts.quoteConsentAsk ?? false,
  );
}

/**
 * The plan-dependent parts of the live agent, resolved once per publish so the
 * prompt and the tools always agree:
 *  - staff mode is Pro only
 *  - the "can we text you about your quote?" ask is on only with Pro + quote
 *    follow-up on + the owner's separate switch on (default off)
 * Unknown plan (lookup failed) fails open for staff (as before) but CLOSED for
 * the quote ask: an AI asking callers to be texted needs a positive yes.
 */
export async function agentPlanOptions(
  client: Pick<ClientWithRelations, "id" | "status" | "setupFlags">,
): Promise<{ staffAllowed: boolean; quoteConsentAsk: boolean }> {
  const access = await planAccessFor(client).catch(() => null);
  return {
    staffAllowed: access ? access.has("staff_mode") : true,
    quoteConsentAsk: quoteConsentAskOn({
      planAllows: access ? access.has("quote_followup") : false,
      settings: parseQuoteSettings(client.setupFlags),
    }),
  };
}

/**
 * Where an emergency call goes at any hour, or null when the business chose
 * "take an urgent message" (or has no number to send it to).
 */
export function emergencyTransferFor(
  client: Pick<ClientWithRelations, "escalationNumber" | "setupFlags">,
): string | null {
  const e = client.setupFlags?.emergency;
  if (!e?.transfer247) return null;
  return e.onCallNumber?.trim() || client.escalationNumber?.trim() || null;
}

/** Rebuild the Retell general prompt from a client's current data (§B5). */
export function buildPromptForClient(
  client: ClientWithRelations,
  opts: { staffAllowed?: boolean; quoteConsentAsk?: boolean } = {},
): string {
  const staffAllowed = opts.staffAllowed ?? true;
  return buildGeneralPrompt({
    agentName: client.agentName?.trim() || DEFAULT_AGENT_NAME,
    client: {
      name: client.name,
      industry: client.industry,
      address: client.address,
      howToFindUs: client.howToFindUs,
      calendarProvider: client.calendarProvider,
      timezone: client.timezone,
      escalationNumber: client.escalationNumber,
      recordingDisclosureEnabled: client.recordingDisclosureEnabled,
      recordingDisclosureLine: client.recordingDisclosureLine,
      guidance: client.agentGuidance,
      bookingInstructions: client.bookingInstructions,
      humanHandoffEnabled: client.humanHandoffEnabled,
      handoffMode: client.setupFlags?.handoffMode ?? "always",
      humanHoursNote: client.humanHoursNote,
      languages: client.languages,
      // Missed-only mode: the agent acknowledges the caller expected a person.
      answeringMode: client.answeringMode,
      // The agent only promises booking when a calendar is actually connected.
      bookingEnabled: getBookingProviderForClient(client).isConfigured(),
      emergencyTransfer247: emergencyTransferFor(client) != null,
      tripFeeCents: client.tripFeeCents,
      quoteTextConsentAsk: opts.quoteConsentAsk === true,
    },
    services: client.services,
    hours: client.businessHours,
    knowledge: client.knowledgeItems,
    staffNames: client.staffModeEnabled && staffAllowed
      ? client.providers.filter((p) => p.isActive).map((p) => p.name)
      : [],
  });
}

/**
 * Rebuild and push the prompt to the live Retell LLM. Returns false (without
 * throwing) when the client isn't provisioned yet or Retell is unconfigured.
 */
/**
 * Whether this business is on a billing hold (billing-hold.ts): a free trial
 * that ended unpaid, or a live plan whose subscription ended. Fails open:
 * unknown → not on hold.
 */
async function isOnBillingHold(client: {
  id: string;
  status: string;
  trialEndsAt: Date | null;
  setupFlags: { comped?: boolean; stripeUnpaidAt?: string } | null;
}): Promise<boolean> {
  if (client.status === "trial" && !client.trialEndsAt) return false;
  if (client.status !== "trial" && client.status !== "live") return false;
  try {
    const [sub] = await db
      .select({ status: subscriptions.status })
      .from(subscriptions)
      .where(and(eq(subscriptions.clientId, client.id), isNull(subscriptions.deletedAt)))
      .orderBy(desc(subscriptions.createdAt))
      .limit(1);
    return onBillingHold({
      status: client.status,
      comped: Boolean(client.setupFlags?.comped),
      trialEndsAt: client.trialEndsAt,
      subscriptionStatus: sub?.status ?? null,
      stripeUnpaid: Boolean(client.setupFlags?.stripeUnpaidAt),
    });
  } catch (err) {
    logger.warn("agent.billing_hold_check_failed", {
      clientId: client.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export async function syncAgentPrompt(orgId: string, clientId: string): Promise<boolean> {
  const client = await getClient(orgId, clientId);
  if (!client?.retellLlmId || !integrations.retell()) return false;

  // Paused (portal Settings → Receptionist off), a free trial that ended
  // unpaid, or a plan whose subscription ended (billing-hold.ts): the number
  // still answers, but the agent only takes a brief message — no booking, no
  // FAQ answering, no texting. Resume or paying re-syncs and everything comes
  // straight back.
  if (client.status === "paused" || (await isOnBillingHold(client))) {
    await getRetellClient().llm.update(client.retellLlmId, {
      general_prompt: `You are the answering service for ${client.name}. The business has TEMPORARILY TURNED OFF its automated receptionist. Apologize briefly, say the team will call back, and take a message: ask for the caller's name, then their phone number (one question at a time, read the number back), then a one-sentence reason for the call. Do not answer questions about prices, hours, or services. Do not book appointments. Keep the whole call under a minute.`,
      begin_message: withRequiredDisclosure(
        `Thanks for calling ${client.name}. I'm an AI assistant taking messages right now, so the team can call you back.`,
        { businessName: client.name, recording: client.recordingDisclosureEnabled },
      ),
      // Message-taking only: strip the booking/cancel tools so a paused
      // business can't get a real booking row from an LLM that ignores the
      // prompt — keep take_message and the human-transfer path.
      general_tools: agentToolsFor(client, clientId).filter(
        (t) =>
          t.name === "take_message" ||
          t.name === "transfer_to_human" ||
          t.name === "transfer_emergency",
      ),
    });
    return true;
  }

  // Language lives on the AGENT, not the LLM — without this line the Spanish
  // toggle edits the prompt while the speech model stays English-only.
  if (client.retellAgentId) {
    await getRetellClient().agent.update(client.retellAgentId, {
      ...agentSpeechSettings(client.languages),
      ...agentConversationSettings(client.timezone),
    });
  }

  const planOpts = await agentPlanOptions(client);
  await getRetellClient().llm.update(client.retellLlmId, {
    // Staff mode is a Pro feature: a cheaper plan never gets per-person booking
    // on the live line, whatever the flag says.
    general_prompt: buildPromptForClient(client, planOpts),
    // The greeting with the AI/recording disclosure enforced — a custom
    // greeting can add to it but can't drop it.
    begin_message: openingLine(client),
    // Rebuild tools too: an escalation-number change swaps between the native
    // transfer tool and the message-taking fallback — without this, the live
    // agent keeps the old transfer behavior until a full re-provision.
    general_tools: agentToolsFor(client, clientId, planOpts),
  });
  return true;
}

/**
 * What happened to the LIVE agent when we saved.
 *
 * "synced" is the only one that means the person on the phone hears the change.
 * The other two used to be indistinguishable from success, which is how a
 * business could edit its greeting, be told "Saved", and still get answered with
 * the old one.
 */
export type AgentSyncStatus = "synced" | "not_provisioned" | "failed";

/**
 * Remember whether the last push to the live receptionist succeeded, so the
 * operator tab can show "up to date" or "Update failed — Retry" after a reload.
 * Best-effort: a flag write must never hide or fail the save itself.
 */
async function recordAgentSync(clientId: string, status: AgentSyncStatus): Promise<void> {
  if (status === "not_provisioned") return;
  const failedAt = status === "failed" ? new Date().toISOString() : null;
  try {
    const nextFlag = failedAt
      ? sql`jsonb_set(coalesce(${clients.setupFlags}, '{}'::jsonb), '{agentSyncFailedAt}', to_jsonb(${failedAt}::text))`
      : sql`jsonb_set(coalesce(${clients.setupFlags}, '{}'::jsonb), '{agentSyncFailedAt}', 'null'::jsonb)`;
    await db.update(clients).set({ setupFlags: nextFlag }).where(eq(clients.id, clientId));
  } catch (err) {
    logger.warn("agent.sync_status_write_failed", {
      clientId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Push the current prompt once, and if Retell errors, try a second time before
 * telling the user it failed. `not_provisioned` is not an error — there's no
 * live agent to update yet.
 */
async function pushPrompt(orgId: string, clientId: string): Promise<AgentSyncStatus> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return (await syncAgentPrompt(orgId, clientId)) ? "synced" : "not_provisioned";
    } catch (err) {
      logger.warn("agent.autosync.failed", {
        clientId,
        attempt,
        error: err instanceof Error ? err.message : String(err),
      });
      if (attempt === 1) continue;
      return "failed";
    }
  }
  return "failed";
}

/**
 * Shared post-edit hook for self-serve fields (services / hours / knowledge /
 * greeting / guardrails / operator config): refresh both views and push the
 * rebuilt prompt to the live agent, so any edit takes effect immediately.
 * Retries once on a Retell error, then records the failure so the operator
 * tab can offer a manual Retry (which also snapshots a versioned prompt).
 *
 * Still best-effort — a Retell hiccup must never lose an edit that's already
 * safely in the database. But it now reports what happened, so callers can say
 * so instead of claiming a success nobody verified.
 */
export async function applyClientEdit(
  user: { orgId: string },
  clientId: string,
): Promise<AgentSyncStatus> {
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/portal", "layout");
  const status = await pushPrompt(user.orgId, clientId);
  await recordAgentSync(clientId, status);
  return status;
}

/**
 * Turn a save confirmation into an honest one. The edit is saved either way —
 * that's why this appends rather than replaces. What changes is whether we can
 * claim the phone line reflects it yet.
 */
export function withSyncNote(message: string, sync: AgentSyncStatus): string {
  if (sync === "synced") return message;
  if (sync === "not_provisioned") return `${message} It'll apply once your AI is activated.`;
  return `${message} We couldn't update the live receptionist just now — click Retry, or save again in a minute.`;
}
