import "server-only";
import { revalidatePath } from "next/cache";
import { getClient, type ClientWithRelations } from "@/lib/data/clients";
import { getBookingProviderForClient } from "@/lib/booking";
import { buildGeneralPrompt, DEFAULT_AGENT_NAME, defaultGreeting } from "@/lib/prompt";
import { buildAgentTools, getRetellClient } from "@/lib/retell";
import { env, integrations } from "@/lib/env";
import { logger } from "@/lib/logger";

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
      humanHoursNote: client.humanHoursNote,
      languages: client.languages,
      // The agent only promises booking when a calendar is actually connected.
      bookingEnabled: getBookingProviderForClient(client).isConfigured(),
    },
    services: client.services,
    hours: client.businessHours,
    knowledge: client.knowledgeItems,
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
      general_tools: buildAgentTools(env.APP_URL, clientId, client.escalationNumber),
    });
    return true;
  }

  await getRetellClient().llm.update(client.retellLlmId, {
    general_prompt: buildPromptForClient(client),
    begin_message:
      client.greeting?.trim() ||
      defaultGreeting({ name: client.name }, client.agentName?.trim() || DEFAULT_AGENT_NAME),
    // Rebuild tools too: an escalation-number change swaps between the native
    // warm-transfer tool and the message-taking fallback — without this, the
    // live agent keeps the old transfer behavior until a full re-provision.
    general_tools: buildAgentTools(env.APP_URL, clientId, client.escalationNumber),
  });
  return true;
}

/**
 * Shared post-edit hook for self-serve fields (services / hours / knowledge /
 * greeting / guardrails): refresh both the operator and portal views and push the
 * rebuilt prompt to the live agent, so any edit takes effect immediately. The
 * operator's explicit "Publish" button additionally snapshots a versioned prompt.
 * Best-effort: a Retell hiccup never fails the save.
 */
export async function applyClientEdit(user: { orgId: string }, clientId: string): Promise<void> {
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/portal", "layout");
  try {
    await syncAgentPrompt(user.orgId, clientId);
  } catch (err) {
    logger.warn("agent.autosync.failed", {
      clientId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
