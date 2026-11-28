import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getPortalEditAccess, resolvePortalClient } from "@/lib/auth-guard";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import { getTrialState } from "@/lib/data/trial";
import { subscriptionInterval } from "@/lib/subscription-interval";
import { minutesUsage, periodStart } from "@/lib/minutes";
import { countedMinutesSince } from "@/lib/minute-cap-run";
import { PLANS, type PlanKey } from "@/config/plans";
import { env, integrations } from "@/lib/env";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PlanCard } from "@/components/portal/plan-card";
import { ManageBilling } from "@/components/portal/manage-billing";
import { ChoosePlan } from "@/components/portal/choose-plan";
import { StartPlanNow } from "@/components/portal/start-plan-now";
import { TrialCodeCard } from "@/components/portal/trial-code-card";

export const metadata: Metadata = { title: "Plan & billing · Settings" };

/**
 * Settings → Plan & billing (owners): the plan you're on, trial days left,
 * changing plan, and Stripe's billing portal for the card and invoices.
 *
 * Plans used to be reachable only from Overview, and a trial business opening
 * Settings found no billing section at all. Everything here reuses the cards
 * the rest of the portal already uses, with the same plan gating.
 */
export default async function PortalBillingPage() {
  const { clientId } = await resolvePortalClient();
  const editAccess = await getPortalEditAccess(clientId);
  if (!editAccess.isAdmin) redirect("/portal/settings");
  const client = await getClientByIdUnsafe(clientId);
  if (!client) notFound();

  const [trial, [sub]] = await Promise.all([
    getTrialState(clientId),
    db
      .select({
        customerId: subscriptions.stripeCustomerId,
        plan: subscriptions.plan,
        status: subscriptions.status,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        subId: subscriptions.stripeSubscriptionId,
        monthlyPriceCents: subscriptions.monthlyPriceCents,
      })
      .from(subscriptions)
      .where(and(eq(subscriptions.clientId, clientId), isNull(subscriptions.deletedAt)))
      .orderBy(desc(subscriptions.createdAt))
      .limit(1),
  ]);

  const fmtDay = (d: Date) =>
    d.toLocaleDateString("en-US", { weekday: "short", month: "long", day: "numeric", timeZone: client.timezone || "America/Los_Angeles" });

  const planKey =
    sub?.plan && sub.plan in PLANS && (sub.status === "active" || sub.status === "trialing") ? (sub.plan as PlanKey) : null;
  let usage = null;
  const interval = planKey ? await subscriptionInterval(sub?.subId) : "month";
  if (planKey) {
    const used = await countedMinutesSince(clientId, periodStart(sub!.currentPeriodEnd), client.setupFlags?.blockedNumbers ?? []);
    usage = minutesUsage(used * 60, PLANS[planKey].includedMinutes);
  }
  const firstChargeOn = sub?.status === "trialing" && sub.currentPeriodEnd ? fmtDay(sub.currentPeriodEnd) : null;

  let title: string;
  let description: string;
  if (trial.comped) {
    title = "Free access";
    description = "Your account is free, courtesy of FrontDesk AI. There's nothing to pay.";
  } else if (planKey) {
    title = `${PLANS[planKey].name} plan`;
    description =
      sub?.status === "trialing" && firstChargeOn
        ? `Your card is saved and first charged on ${firstChargeOn}.`
        : sub?.currentPeriodEnd
          ? `Renews on ${fmtDay(sub.currentPeriodEnd)}. Change plan below, or use Manage billing for your card and invoices.`
          : "Change plan below, or use Manage billing for your card and invoices.";
  } else if (trial.active) {
    title = `Free trial · ${trial.daysLeft} day${trial.daysLeft === 1 ? "" : "s"} left`;
    description = `${trial.endsAt ? `Your trial ends ${fmtDay(trial.endsAt)}. ` : ""}Everything's on and no card is needed. Choosing a plan charges today and ends the trial.`;
  } else if (client.setupFlags?.stripeUnpaidAt) {
    title = "Payment needed";
    description = "Your last payment didn't go through. Update your card under Manage billing and everything carries on.";
  } else if (trial.expired) {
    title = "Your free trial has ended";
    description = "Pick a plan to keep your receptionist answering. Everything you set up is still here.";
  } else {
    title = "No plan yet";
    description = "Pick a plan to keep your receptionist answering.";
  }

  const showPlans = !trial.comped && !trial.subscribed;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="gap-1">
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
      </Card>
      {planKey && usage ? (
        <PlanCard
          clientId={clientId}
          plan={planKey}
          usage={usage}
          interval={interval}
          paidMonthlyCents={sub?.monthlyPriceCents ?? null}
          plusTax={env.STRIPE_AUTOMATIC_TAX}
        />
      ) : null}
      {sub?.status === "trialing" ? <StartPlanNow clientId={clientId} firstChargeOn={firstChargeOn} /> : null}
      {showPlans ? (
        <div id="plans" className="scroll-mt-24 space-y-4">
          <ChoosePlan
            clientId={clientId}
            onTrial={trial.active}
            cardsReady={integrations.stripe()}
            plusTax={env.STRIPE_AUTOMATIC_TAX}
            textingLive={env.SMS_ENABLED}
            preselect={client.setupFlags?.intendedPlan ?? null}
            preselectInterval={client.setupFlags?.intendedInterval ?? null}
          />
          <TrialCodeCard clientId={clientId} requested={Boolean(client.trialRequestedAt)} />
        </div>
      ) : null}
      {sub?.customerId ? <ManageBilling clientId={clientId} /> : null}
    </div>
  );
}
