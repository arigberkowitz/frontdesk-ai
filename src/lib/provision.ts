import "server-only";
import { revalidatePath } from "next/cache";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { getClient, updateClient } from "@/lib/data/clients";
import { createAgentVersion } from "@/lib/data/agent-versions";
import { DEFAULT_AGENT_NAME, openHoursSummary, openingLine } from "@/lib/prompt";
import { agentPlanOptions, buildPromptForClient, emergencyTransferFor } from "@/lib/agent-publish";
import { provisionAgentForClient } from "@/lib/retell";
import { env, integrations, webhookUrl } from "@/lib/env";
import { ensureTollfreeNumber } from "@/lib/tollfree/service";
import { liveTollfreeDeps } from "@/lib/tollfree/deps";
import { logger } from "@/lib/logger";
import type { ActionState } from "@/lib/actions/types";
import { claimFirstProvision, releaseFirstProvision } from "@/lib/provision-lock";
import { getNumberGate } from "@/lib/data/number-gate";
import { isUnpaidTrialUnlock, type NumberGateFacts } from "@/lib/number-gate";
import { isSuspended } from "@/lib/operator/suspension";

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
 * test call talks to. The NUMBER is a monthly vendor charge: a free trial gets
 * one after its first test call (under a daily cap), a paying or carded
 * business straight away, and an operator always. Until then this returns
 * `numberReserved: true` with the reason. See number-gate.ts.
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
  // An operator suspended this business: nothing may build it an agent or buy
  // it a number until they reactivate it.
  if (isSuspended(client)) {
    return { ok: false, error: "This company is suspended. Reactivate it first." };
  }
  if (!integrations.retell()) {
    return { ok: false, error: "Connect Retell first — add RETELL_API_KEY to your environment." };
  }

  const firstProvision = !client.retellPhoneNumber;
  // Only matters when there's no number yet: an existing one is just re-bound.
  const gate = firstProvision ? await getNumberGate(clientId, user.role) : null;
  const numberReserved = Boolean(gate && !gate.unlocked);
  if (gate?.reason === "daily_cap") {
    // Worth a look: either a good day or a burst of fake signups.
    logger.warn("agent.provision.trial_number_cap_reached", { clientId });
  }
  if (firstProvision && !(await claimFirstProvision(clientId))) {
    return {
      ok: false,
      error: "Your receptionist is already being set up. Give it a minute, then refresh this page.",
    };
  }

  try {
    const agentName = client.agentName?.trim() || DEFAULT_AGENT_NAME;
    const planOpts = await agentPlanOptions(client);
    const prompt = buildPromptForClient(client, planOpts);
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
      waitlistEnabled: client.waitlistEnabled,
      emergencyNumber: emergencyTransferFor(client),
      quoteTextConsent: planOpts.quoteConsentAsk,
      languages: client.languages,
      timezone: client.timezone,
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

    if (firstProvision && result.phoneNumber && user.role === "operator" && client.setupFlags?.operatorNumberHoldAt) {
      // The operator released this business's number earlier and has now chosen to give it a new one.
      await db
        .update(clients)
        .set({ setupFlags: sql`coalesce(${clients.setupFlags}, '{}'::jsonb) - 'operatorNumberHoldAt'` })
        .where(eq(clients.id, clientId));
    }
    await updateClient(user.orgId, clientId, {
      retellLlmId: result.llmId,
      retellAgentId: result.agentId,
      retellPhoneNumber: result.phoneNumber,
      greeting,
    });
    if (firstProvision && result.phoneNumber && isUnpaidTrialUnlock(gate?.via ?? null)) {
      // Counts toward the platform-wide daily cap on trial numbers. In SQL so
      // a flag written meanwhile isn't lost.
      await db
        .update(clients)
        .set({
          setupFlags: sql`jsonb_set(coalesce(${clients.setupFlags}, '{}'::jsonb), '{trialNumberAt}', to_jsonb(${new Date().toISOString()}::text))`,
        })
        .where(eq(clients.id, clientId));
    }
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
      data: {
        phoneNumber: result.phoneNumber,
        phoneError: result.phoneError,
        numberReserved,
        reservedReason: numberReserved ? (gate?.reason ?? null) : null,
      },
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
 * Give a business that already built its receptionist the number it's now
 * allowed (number-gate.ts) — after a payment or saved card (Stripe webhook),
 * or after a free trial's first test call (Retell webhook). Best-effort: if it
 * fails, "Get my phone number" on Your AI is the same thing by hand. Never buys
 * for a business that has one, or one that never built an agent (its own
 * Activate covers that), and the gate + first-provision lock decide the rest,
 * so calling it twice buys at most one.
 */
export async function provisionNumberIfUnlocked(clientId: string): Promise<void> {
  if (!integrations.retell()) return;
  const client = await getClientForPayment(clientId);
  if (!client || client.retellPhoneNumber || !client.retellAgentId) return;
  // Suspended, or its number was released by the operator on purpose: don't quietly buy another.
  if (isSuspended(client) || client.setupFlags?.operatorNumberHoldAt) return;
  const gate = await getNumberGate(clientId, "system");
  if (!gate.unlocked) return;
  const result = await runProvision({ id: null, orgId: client.orgId, role: "system" }, clientId);
  const data = result.data as { phoneNumber?: string | null } | undefined;
  logger.info("provision.number_when_unlocked", {
    clientId,
    via: gate.via,
    ok: result.ok,
    gotNumber: Boolean(data?.phoneNumber),
  });
}

/**
 * A payment or a saved card just landed (Stripe webhook): the toll-free
 * texting number (its own, stricter gate) and then the voice number.
 */
export async function provisionNumberAfterPayment(clientId: string): Promise<void> {
  // Toll-free texting number (no-op unless TOLLFREE_SMS_ENABLED=on). Gated:
  // only buys once setup is finished too — paying alone isn't enough. Its own
  // try: a texting hiccup must never block the voice number below.
  await ensureTollfreeNumberSafely(clientId, "payment");
  await provisionNumberIfUnlocked(clientId);
}

/**
 * Toll-free texting number, best-effort. `ensureTollfreeNumber` only buys when
 * setup is finished, a subscription is active and has a real payment over $0
 * (not merely trialing, and not a 100%-off promo), and the business has no
 * texting number — and never twice (atomic claim in data/tollfree.ts). Called
 * from both the Stripe webhook (including when a trial or promo later pays)
 * and "I'm done" on setup: whichever comes second, once they've actually
 * paid, buys. Separate from the Retell voice number entirely: a trial's voice
 * number never buys a texting number.
 */
export async function ensureTollfreeNumberSafely(clientId: string, source: "payment" | "setup"): Promise<void> {
  try {
    await ensureTollfreeNumber(liveTollfreeDeps(), clientId);
  } catch (err) {
    logger.warn(`tollfree.ensure_after_${source}_failed`, {
      clientId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function getClientForPayment(clientId: string) {
  return db.query.clients.findFirst({
    where: and(eq(clients.id, clientId), isNull(clients.deletedAt)),
    columns: { id: true, orgId: true, retellPhoneNumber: true, retellAgentId: true, setupFlags: true },
  });
}
