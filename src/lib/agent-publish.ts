import "server-only";
import { revalidatePath } from "next/cache";
import { getClient, type ClientWithRelations } from "@/lib/data/clients";
import { getBookingProviderForClient } from "@/lib/booking";
import { buildGeneralPrompt, DEFAULT_AGENT_NAME, defaultGreeting } from "@/lib/prompt";
import { getRetellClient } from "@/lib/retell";
import { integrations } from "@/lib/env";
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
  await getRetellClient().llm.update(client.retellLlmId, {
    general_prompt: buildPromptForClient(client),
    begin_message:
      client.greeting?.trim() ||
      defaultGreeting({ name: client.name }, client.agentName?.trim() || DEFAULT_AGENT_NAME),
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
