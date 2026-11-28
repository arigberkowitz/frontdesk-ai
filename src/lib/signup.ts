import "server-only";
import { eq } from "drizzle-orm";
import { after } from "next/server";
import { db } from "@/db";
import { clients, users } from "@/db/schema";
import { TRIAL_DAYS } from "@/config/plans";
import { seedClientFromPack } from "@/lib/starter-seed";
import { runProvision, type ProvisionActor } from "@/lib/provision";
import { sendWelcomeEmail } from "@/lib/lifecycle";
import { integrations } from "@/lib/env";
import { logger } from "@/lib/logger";
import { signupDefaults } from "@/lib/signup-defaults";
import { isTrialBlocked } from "@/lib/operator/store";

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
 * (the prompt is built from services and hours), then the agent, then the
 * welcome email.
 *
 * The agent first, the number right after. A self-serve signup gets a
 * receptionist it can hear in the browser straight away; its own phone number
 * is set up after the owner's first test call (number-gate.ts), under a daily
 * cap. Buying one the instant a form was submitted let anyone with a few email
 * addresses run up the vendor bill.
 */
export async function finishSignup(
  user: Omit<ProvisionActor, "id"> & { id: string },
  clientId: string,
  opts: { industry: string | null; seedFromPack: boolean; intendedPlan?: string; intendedInterval?: "month" | "year"; companySize: string; ownerCell?: string | null },
): Promise<void> {
  // An operator deleted a company for fraud and flagged this email / phone /
  // company domain: no free trial (and so no number or agent) for it. They can
  // still pay for a plan, or write to support. Fails open — see isTrialBlocked.
  const [member] = await db.select({ email: users.email }).from(users).where(eq(users.id, user.id)).limit(1);
  const [owned] = await db.select({ ownerEmail: clients.ownerEmail }).from(clients).where(eq(clients.id, clientId)).limit(1);
  if (await isTrialBlocked({ emails: [member?.email, owned?.ownerEmail], phones: [opts.ownerCell] })) {
    logger.warn("signup.trial_blocked", { clientId });
    await db
      .update(clients)
      .set({
        companySize: opts.companySize,
        industry: opts.industry,
        setupFlags: { trialBlocked: true },
      })
      .where(eq(clients.id, clientId));
    return;
  }
  await db
    .update(clients)
    .set({
      companySize: opts.companySize,
      // reviewRequired: the template content seeded below (and the starter
      // greeting) only counts on the checklist once the owner confirms it.
      setupFlags: { reviewRequired: true, ...(opts.intendedPlan ? { intendedPlan: opts.intendedPlan } : {}), ...(opts.intendedInterval ? { intendedInterval: opts.intendedInterval } : {}) },
      staffModeEnabled: opts.companySize !== "solo",
      // Default is still English + Spanish. The site advertises 10 languages
      // (pick up to 4); the owner can add more in settings.
      languages: "en-es",
      industry: opts.industry,
      // Two weeks, starting now, no card, no code, no approval queue.
      status: "trial",
      trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
    })
    .where(eq(clients.id, clientId));
  // Advertised features on, owner's cell as the transfer line (signup-defaults.ts).
  await db.update(clients).set(signupDefaults(opts.ownerCell)).where(eq(clients.id, clientId));

  if (opts.seedFromPack) {
    await seedClientFromPack(user.orgId, clientId, opts.industry);
  }

  // Built before they see the portal (the number follows the first test
  // call — see above). If the
  // voice vendor is down the Activate button is still there as the fallback;
  // signup never fails here.
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
