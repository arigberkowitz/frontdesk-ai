"use server";

import { revalidatePath } from "next/cache";
import { assertClientEditor, requireOperator } from "@/lib/auth-guard";
import { agentConfigSchema, emptyToNull } from "@/lib/validation";
import { assertClientInOrg, getClient, updateClient } from "@/lib/data/clients";
import { createAgentVersion } from "@/lib/data/agent-versions";
import { defaultGreeting, DEFAULT_AGENT_NAME } from "@/lib/prompt";
import { buildPromptForClient } from "@/lib/agent-publish";
import {
  DEFAULT_VOICE_ID,
  getRetellClient,
  provisionAgentForClient,
  updateAgentVoice,
} from "@/lib/retell";
import { env, integrations, webhookUrl } from "@/lib/env";
import { logger } from "@/lib/logger";
import { type ActionState, fieldErrorsOf } from "./types";

export async function saveAgentConfigAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireOperator();
  const clientId = String(formData.get("clientId") ?? "");
  const parsed = agentConfigSchema.safeParse({
    greeting: formData.get("greeting"),
    agentName: formData.get("agentName"),
    voiceId: formData.get("voiceId"),
    escalationNumber: formData.get("escalationNumber"),
    recordingDisclosureEnabled: formData.get("recordingDisclosureEnabled") !== null,
    recordingDisclosureLine: formData.get("recordingDisclosureLine"),
    agentGuidance: formData.get("agentGuidance"),
    bookingInstructions: formData.get("bookingInstructions"),
  });
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };

  await assertClientInOrg(user.orgId, clientId);
  const existing = await getClient(user.orgId, clientId);
  const d = parsed.data;
  const newVoiceId = emptyToNull(d.voiceId);
  await updateClient(user.orgId, clientId, {
    greeting: emptyToNull(d.greeting),
    agentName: emptyToNull(d.agentName),
    voiceId: newVoiceId,
    escalationNumber: emptyToNull(d.escalationNumber),
    recordingDisclosureEnabled: d.recordingDisclosureEnabled,
    recordingDisclosureLine: emptyToNull(d.recordingDisclosureLine),
    agentGuidance: emptyToNull(d.agentGuidance),
    bookingInstructions: emptyToNull(d.bookingInstructions),
  });

  // Push a voice change straight to the live Retell agent — a DB-only save would
  // otherwise leave the provisioned agent on its old voice until the next
  // re-provision. (Mirrors the client-portal voice picker.)
  if (
    existing?.retellAgentId &&
    integrations.retell() &&
    newVoiceId !== existing.voiceId
  ) {
    try {
      await updateAgentVoice(existing.retellAgentId, newVoiceId || DEFAULT_VOICE_ID);
    } catch (err) {
      revalidatePath(`/clients/${clientId}`);
      return {
        ok: false,
        error: `Saved, but updating the live agent's voice failed: ${
          err instanceof Error ? err.message : "unknown"
        }. It'll apply next time you provision.`,
      };
    }
  }

  revalidatePath(`/clients/${clientId}`);
  return { ok: true };
}

/**
 * Shared provisioning core: create/update the Retell LLM + agent + number and
 * snapshot a version (§B2/B5). Used by both the operator dashboard and the
 * self-serve client portal — each wraps this with its own auth guard.
 */
async function runProvision(
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

/** Operator dashboard: create or update the Retell agent + number (§B2/B5). */
export async function provisionAgentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireOperator();
  const clientId = String(formData.get("clientId") ?? "");
  return runProvision(user, clientId);
}

/**
 * Client portal: a self-serve business owner activates / re-syncs their own AI
 * receptionist. Guarded by tenant access; read-only client viewers can't provision.
 */
export async function provisionAgentPortalAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const user = await assertClientEditor(clientId);
  if (user.role !== "operator") {
    return { ok: false, error: "Only the business owner can activate the receptionist." };
  }
  await assertClientInOrg(user.orgId, clientId);
  return runProvision(user, clientId);
}

/** Snapshot a new version and push the rebuilt prompt to Retell (§B5). */
export async function publishAgentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireOperator();
  const clientId = String(formData.get("clientId") ?? "");
  const notes = String(formData.get("notes") ?? "").trim();
  const client = await getClient(user.orgId, clientId);
  if (!client) return { ok: false, error: "Client not found." };

  const prompt = buildPromptForClient(client);

  if (client.retellLlmId && integrations.retell()) {
    try {
      await getRetellClient().llm.update(client.retellLlmId, {
        general_prompt: prompt,
        begin_message:
          client.greeting?.trim() ||
          defaultGreeting({ name: client.name }, client.agentName?.trim() || DEFAULT_AGENT_NAME),
      });
    } catch (err) {
      return {
        ok: false,
        error: `Retell update failed: ${err instanceof Error ? err.message : "unknown"}`,
      };
    }
  }

  await createAgentVersion(clientId, {
    promptSnapshot: prompt,
    knowledgeSnapshot: client.knowledgeItems,
    publishedBy: user.id,
    notes: notes || null,
  });
  revalidatePath(`/clients/${clientId}`);
  return { ok: true };
}
