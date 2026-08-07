import "server-only";
import { revalidatePath } from "next/cache";
import { getClient, type ClientWithRelations } from "@/lib/data/clients";
import { getBookingProviderForClient } from "@/lib/booking";
import {
  buildGeneralPrompt,
  DEFAULT_AGENT_NAME,
  defaultGreeting,
  openHoursSummary,
} from "@/lib/prompt";
import { buildAgentTools, getRetellClient } from "@/lib/retell";
import { env, integrations } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * The live agent's tools, built from what this business has actually chosen.
 *
 * Every call site used to build these WITHOUT the handoff mode, so it silently
 * fell back to "always". A business could pick "never transfer" in Settings,
 * get a prompt that promised to take a message, and still be published with a
 * live transfer tool attached — the setting was half-wired, and the half that
 * was wrong is the half that rings somebody's phone at eleven at night.
 */
export function agentToolsFor(client: ClientWithRelations, clientId: string) {
  return buildAgentTools(
    env.APP_URL,
    clientId,
    client.escalationNumber,
    client.setupFlags?.handoffMode ?? "always",
    openHoursSummary(client.businessHours),
  );
}

/** Rebuild the Retell general prompt from a client's current data (§B5). */
export function buildPromptForClient(client: ClientWithRelations): string {
  return buildGeneralPrompt({
    agentName: client.agentName?.trim() || DEFAULT_AGENT_NAME,
    client: {
      name: client.name,
      industry: client.industry,
      address: client.address,
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
    },
    services: client.services,
    hours: client.businessHours,
    knowledge: client.knowledgeItems,
    staffNames: client.staffModeEnabled
      ? client.providers.filter((p) => p.isActive).map((p) => p.name)
      : [],
  });
}

/**
 * Rebuild and push the prompt to the live Retell LLM. Returns false (without
 * throwing) when the client isn't provisioned yet or Retell is unconfigured.
 */
export async function syncAgentPrompt(orgId: string, clientId: string): Promise<boolean> {
  const client = await getClient(orgId, clientId);
  if (!client?.retellLlmId || !integrations.retell()) return false;

  // Paused (portal Settings → Receptionist off): the number still answers, but
  // the agent only takes a brief message — no booking, no FAQ answering, no
  // texting. Resume re-syncs and everything comes straight back.
  if (client.status === "paused") {
    await getRetellClient().llm.update(client.retellLlmId, {
      general_prompt: `You are the answering service for ${client.name}. The business has TEMPORARILY TURNED OFF its automated receptionist. Apologize briefly, say the team will call back, and take a message: ask for the caller's name, then their phone number (one question at a time, read the number back), then a one-sentence reason for the call. Do not answer questions about prices, hours, or services. Do not book appointments. Keep the whole call under a minute.`,
      begin_message: `Thanks for calling ${client.name}. Our automated assistant is off right now, but I can take a quick message so the team calls you back.`,
      // Message-taking only: strip the booking/cancel tools so a paused
      // business can't get a real booking row from an LLM that ignores the
      // prompt — keep take_message and the human-transfer path.
      general_tools: agentToolsFor(client, clientId).filter(
        (t) => t.name === "take_message" || t.name === "transfer_to_human",
      ),
    });
    return true;
  }

  // Language lives on the AGENT, not the LLM — without this line the Spanish
  // toggle edits the prompt while the speech model stays English-only.
  if (client.retellAgentId) {
    await getRetellClient().agent.update(client.retellAgentId, {
      language: client.languages && client.languages !== "en" ? "multi" : "en-US",
    });
  }

  await getRetellClient().llm.update(client.retellLlmId, {
    general_prompt: buildPromptForClient(client),
    begin_message:
      client.greeting?.trim() ||
      defaultGreeting({ name: client.name }, client.agentName?.trim() || DEFAULT_AGENT_NAME),
    // Rebuild tools too: an escalation-number change swaps between the native
    // transfer tool and the message-taking fallback — without this, the live
    // agent keeps the old transfer behavior until a full re-provision.
    general_tools: agentToolsFor(client, clientId),
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
 * Shared post-edit hook for self-serve fields (services / hours / knowledge /
 * greeting / guardrails): refresh both the operator and portal views and push the
 * rebuilt prompt to the live agent, so any edit takes effect immediately. The
 * operator's explicit "Publish" button additionally snapshots a versioned prompt.
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
  try {
    return (await syncAgentPrompt(user.orgId, clientId)) ? "synced" : "not_provisioned";
  } catch (err) {
    logger.warn("agent.autosync.failed", {
      clientId,
      error: err instanceof Error ? err.message : String(err),
    });
    return "failed";
  }
}

/**
 * Turn a save confirmation into an honest one. The edit is saved either way —
 * that's why this appends rather than replaces. What changes is whether we can
 * claim the phone line reflects it yet.
 */
export function withSyncNote(message: string, sync: AgentSyncStatus): string {
  if (sync === "synced") return message;
  if (sync === "not_provisioned") return `${message} It'll apply once your AI is activated.`;
  return `${message} We couldn't reach your live AI just now, so callers still hear the previous version — save again in a minute.`;
}
