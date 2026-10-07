import "server-only";
import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { getClient, updateClient } from "@/lib/data/clients";
import { createAgentVersion } from "@/lib/data/agent-versions";
import { DEFAULT_AGENT_NAME, openHoursSummary, openingLine } from "@/lib/prompt";
import { buildPromptForClient } from "@/lib/agent-publish";
import { provisionAgentForClient } from "@/lib/retell";
import { env, integrations, webhookUrl } from "@/lib/env";
import { logger } from "@/lib/logger";
import type { ActionState } from "@/lib/actions/types";
import { claimFirstProvision, releaseFirstProvision } from "@/lib/provision-lock";
import { getNumberGate } from "@/lib/data/number-gate";
import type { NumberGateFacts } from "@/lib/number-gate";

/**
 * The Retell phone error names Retell and "a payment method" — advice for the
 * platform operator, not for a business owner, who can't add a card to our
 * vendor account. Owners get a sentence they can act on.
 */
export const OWNER_PHONE_ERROR =
  "Your AI is built, but we couldn't get its phone number just yet. Try Activate again in a few minutes — or use the browser test call meanwhile. If it keeps happening, message us from Settings → Help.";

/** Who is provisioning. `id` is null for the system (e.g. the Stripe webhook). */
export interface ProvisionActor {
  id: string | null;
  orgId: string;
  role: NumberGateFacts["actorRole"];
}

/**
 * Build (or re-sync) a business's Retell agent and, once it's unlocked, its
 * phone number.
 *
 * The agent is always built — it's free until called and it's what the browser
 * test call talks to. The NUMBER is a monthly vendor charge, so a business only
 * gets one after adding a card or finishing setup (or when an operator does it);
 * until then this returns `numberReserved: true`. See number-gate.ts.
 *
 * Lives outside the "use server" action modules on purpose: exporting it from
 * one would expose it as a callable server action that takes an arbitrary
 * `user`. The actions that call it do the auth; onboarding calls it too.
 */
export async function runProvision(
  user: ProvisionActor,
  clientId: string,
): Promise<ActionState> {
  const client = await getClient(user.orgId, clientId);
  if (!client) return { ok: false, error: "Client not found." };
  if (!integrations.retell()) {
    return { ok: false, error: "Connect Retell first — add RETELL_API_KEY to your environment." };
  }

  const firstProvision = !client.retellPhoneNumber;
  // Only matters when there's no number yet: an existing one is just re-bound.
  const gate = firstProvision ? await getNumberGate(clientId, user.role) : null;
  const numberReserved = Boolean(gate && !gate.unlocked);
  if (firstProvision && !(await claimFirstProvision(clientId))) {
    return {
      ok: false,
      error: "Your receptionist is already being set up. Give it a minute, then refresh this page.",
    };
  }

  try {
    const agentName = client.agentName?.trim() || DEFAULT_AGENT_NAME;
    const prompt = buildPromptForClient(client);
    // Greeting + enforced AI/recording disclosure (see openingLine).
    const greeting = openingLine({ ...client, agentName });
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
      skipNewNumber: numberReserved,
    });
    if (firstProvision) {
      logger.info("agent.provision.number", {
        clientId,
        reserved: numberReserved,
        via: gate?.via ?? null,
        bought: Boolean(result.phoneNumber),
      });
    }

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
    return {
      ok: true,
      data: { phoneNumber: result.phoneNumber, phoneError: result.phoneError, numberReserved },
    };
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
  } finally {
    if (firstProvision) {
      await releaseFirstProvision(clientId).catch((err) =>
        logger.warn("agent.provision.unlock_failed", {
          clientId,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }
}

/**
 * A card just went on file (Stripe checkout / subscription webhook): give a
 * business that already built its receptionist the number it was waiting for.
 * Best-effort — if it fails, the "Get my phone number" button on Your AI is
 * the same thing, by hand. Never buys for a business that has one, or one that
 * never built an agent (its own Activate covers that, number included).
 */
export async function provisionNumberAfterPayment(clientId: string): Promise<void> {
  if (!integrations.retell()) return;
  const client = await getClientForPayment(clientId);
  if (!client || client.retellPhoneNumber || !client.retellAgentId) return;
  const result = await runProvision({ id: null, orgId: client.orgId, role: "system" }, clientId);
  const data = result.data as { phoneNumber?: string | null } | undefined;
  logger.info("billing.number_after_payment", {
    clientId,
    ok: result.ok,
    gotNumber: Boolean(data?.phoneNumber),
  });
}

async function getClientForPayment(clientId: string) {
  return db.query.clients.findFirst({
    where: and(eq(clients.id, clientId), isNull(clients.deletedAt)),
    columns: { id: true, orgId: true, retellPhoneNumber: true, retellAgentId: true },
  });
}
