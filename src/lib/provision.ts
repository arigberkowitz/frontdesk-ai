import "server-only";
import { revalidatePath } from "next/cache";
import { getClient, updateClient } from "@/lib/data/clients";
import { createAgentVersion } from "@/lib/data/agent-versions";
import { defaultGreeting, DEFAULT_AGENT_NAME, openHoursSummary } from "@/lib/prompt";
import { buildPromptForClient } from "@/lib/agent-publish";
import { provisionAgentForClient } from "@/lib/retell";
import { env, integrations, webhookUrl } from "@/lib/env";
import { logger } from "@/lib/logger";
import type { ActionState } from "@/lib/actions/types";

/**
 * Build (or re-sync) a business's Retell agent and phone number.
 *
 * Lives outside the "use server" action modules on purpose: exporting it from
 * one would expose it as a callable server action that takes an arbitrary
 * `user`. The actions that call it do the auth; onboarding calls it too, so a
 * new business is live the moment signup finishes.
 */
export async function runProvision(
  user: { id: string; orgId: string },
  clientId: string,
): Promise<ActionState> {
  const client = await getClient(user.orgId, clientId);
  if (!client) return { ok: false, error: "Client not found." };
  if (!integrations.retell()) {
    return { ok: false, error: "Connect Retell first — add RETELL_API_KEY to your environment." };
  }

  try {
    const agentName = client.agentName?.trim() || DEFAULT_AGENT_NAME;
    const prompt = buildPromptForClient(client);
    const greeting = client.greeting?.trim() || defaultGreeting({ name: client.name }, agentName);
    const boosted = [client.name, ...client.services.filter((s) => s.isActive).map((s) => s.name)]
      .map((s) => s.trim())
      .filter(Boolean);

    // Guardrail: webhook + tool URLs get baked into the Retell agent at
    // provision time. A localhost/non-https APP_URL would create an agent that
    // answers calls but can never reach our webhook or tools — fail loudly.
    if (!env.APP_URL.startsWith("https://") || env.APP_URL.includes("localhost")) {
      throw new Error(
        `APP_URL must be a public https URL before provisioning (got "${env.APP_URL}"). Set APP_URL in your environment.`,
      );
    }

    const result = await provisionAgentForClient({
      clientId: client.id,
      agentName,
      generalPrompt: prompt,
      beginMessage: greeting,
      escalationNumber: client.escalationNumber,
      handoffMode: client.setupFlags?.handoffMode ?? "always",
      openHoursNote: openHoursSummary(client.businessHours),
      languages: client.languages,
      voiceId: client.voiceId,
      boostedKeywords: boosted,
      appUrl: env.APP_URL,
      webhookUrl: webhookUrl("/api/webhooks/retell"),
      existingLlmId: client.retellLlmId,
      existingAgentId: client.retellAgentId,
      existingPhoneNumber: client.retellPhoneNumber,
    });

    await updateClient(user.orgId, clientId, {
      retellLlmId: result.llmId,
      retellAgentId: result.agentId,
      retellPhoneNumber: result.phoneNumber,
      greeting,
    });
    await createAgentVersion(clientId, {
      promptSnapshot: prompt,
      knowledgeSnapshot: client.knowledgeItems,
      publishedBy: user.id,
      notes: "Provisioned",
    });

    revalidatePath(`/clients/${clientId}`);
    revalidatePath("/portal", "layout");
    return { ok: true, data: { phoneNumber: result.phoneNumber, phoneError: result.phoneError } };
  } catch (err) {
    // Log the real cause server-side; never surface raw vendor/DB errors to users.
    logger.error("agent.provision.failed", {
      clientId,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      error:
        "We couldn't set up your receptionist just now. Please try again in a moment, or contact support if it keeps happening.",
    };
  }
}
