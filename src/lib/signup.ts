import "server-only";
import { eq } from "drizzle-orm";
import { after } from "next/server";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { TRIAL_DAYS } from "@/config/plans";
import { seedClientFromPack } from "@/lib/starter-seed";
import { runProvision } from "@/lib/provision";
import { sendWelcomeEmail } from "@/lib/lifecycle";
import { integrations } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Everything that makes a freshly created business *usable*, in one place.
 *
 * There were two ways to sign up — "read my website" and "start from a
 * template" — and only the first one started the trial. The template button
 * created a business in `draft` with no trial clock, so the owner landed on
 * a portal whose Activate button said "unlocks with a plan or an approved
 * free trial". Two entrances, one of them a wall. Both now go through here.
 *
 * Order matters: trial first (provisioning checks it), starter pack second
 * (the prompt is built from services and hours), then the agent and its
 * number, then the welcome email that quotes that number.
 */
export async function finishSignup(
  user: { id: string; orgId: string },
  clientId: string,
  opts: { industry: string | null; seedFromPack: boolean; intendedPlan?: string; companySize: string },
): Promise<void> {
  await db
    .update(clients)
    .set({
      companySize: opts.companySize,
      ...(opts.intendedPlan ? { setupFlags: { intendedPlan: opts.intendedPlan } } : {}),
      staffModeEnabled: opts.companySize !== "solo",
      industry: opts.industry,
      // Three weeks, starting now, no card, no code, no approval queue.
      status: "trial",
      trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
    })
    .where(eq(clients.id, clientId));

  if (opts.seedFromPack) {
    await seedClientFromPack(user.orgId, clientId, opts.industry);
  }

  // Live before they see the portal. If the voice vendor is down the
  // Activate button is still there as the fallback; signup never fails here.
  if (integrations.retell()) {
    try {
      const provisioned = await runProvision(user, clientId);
      if (!provisioned.ok) {
        logger.warn("signup.auto_provision_declined", { clientId, error: provisioned.error });
      }
    } catch (err) {
      logger.warn("signup.auto_provision_failed", {
        clientId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // After the response, so signup isn't waiting on the email vendor.
  after(() =>
    sendWelcomeEmail(clientId).catch((err) =>
      logger.warn("signup.welcome_email_failed", {
        clientId,
        error: err instanceof Error ? err.message : String(err),
      }),
    ),
  );
}
