import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getPortalEditAccess, resolvePortalClient } from "@/lib/auth-guard";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import { getClientSetupStatus } from "@/lib/data/setup";
import { BusinessDetailsForm } from "@/components/portal/portal-settings";
import { SetupChecklist } from "@/components/portal/setup-checklist";
import { DangerZone } from "@/components/portal/danger-zone";
import { LegacySettingsHash } from "@/components/portal/legacy-settings-hash";
import { toSafeClient } from "@/lib/client-safe";
import { ManageBilling } from "@/components/portal/manage-billing";
import { and, desc, eq, isNull } from "drizzle-orm";
import { subscriptionInterval } from "@/lib/subscription-interval";
import { PlanCard } from "@/components/portal/plan-card";
import { minutesUsage, periodStart } from "@/lib/minutes";
import { countedMinutesSince } from "@/lib/minute-cap-run";
import { PLANS, type PlanKey } from "@/config/plans";
import { env } from "@/lib/env";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";

export const metadata: Metadata = { title: "Settings" };

/** Settings → Business (the section /portal/settings opens on). */
export default async function PortalSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ calendar?: string }>;
}) {
  const sp = await searchParams;
  // Calendar connect used to return here (?calendar=connected|error). Anyone
  // mid-OAuth when this shipped still lands on the right section.
  if (sp.calendar) {
    redirect(`/portal/settings/calendar?calendar=${encodeURIComponent(sp.calendar)}`);
  }
  const { clientId } = await resolvePortalClient();
  const editAccess = await getPortalEditAccess(clientId);
  const client = await getClientByIdUnsafe(clientId);
  if (!client) notFound();
  const setup = await getClientSetupStatus(clientId);
  // Anyone Stripe knows (paying, past due, or cancelled) can manage billing.
  const [sub] = editAccess.isAdmin
    ? await db
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
        .limit(1)
    : [];

  const planKey =
    sub?.plan && sub.plan in PLANS && (sub.status === "active" || sub.status === "trialing")
      ? (sub.plan as PlanKey)
      : null;
  let usage = null;
  const interval = planKey ? await subscriptionInterval(sub?.subId) : "month";
  if (planKey) {
    // Same count the minute-cap emails use: robocalls and blocked callers don't count.
    const used = await countedMinutesSince(
      clientId,
      periodStart(sub!.currentPeriodEnd),
      client.setupFlags?.blockedNumbers ?? [],
    );
    usage = minutesUsage(used * 60, PLANS[planKey].includedMinutes);
  }

  return (
    <div className="space-y-6">
      <LegacySettingsHash />
      <BusinessDetailsForm client={toSafeClient(client)} />
      {/* While the checklist is still showing on Overview, don't show the same
          nine steps again here (owner audit: "why is my checklist twice?") —
          just point to it. Once it's finished or hidden there, this is where
          it lives. */}
      {!setup.finishedAt && !setup.hiddenAt ? (
        <p className="rounded-xl border bg-card px-5 py-4 text-sm text-muted-foreground">
          Still setting up? Your checklist is on{" "}
          <Link href="/portal" className="font-medium text-foreground underline underline-offset-2">
            Overview
          </Link>
          .
        </p>
      ) : (
      <SetupChecklist
        clientId={clientId}
        variant="settings"
        canEdit={editAccess.canEdit}
        status={{ ...setup, finishedAt: setup.finishedAt?.toISOString() ?? null }}
      />
      )}
      {planKey && usage ? <PlanCard clientId={clientId} plan={planKey} usage={usage} interval={interval} paidMonthlyCents={sub?.monthlyPriceCents ?? null} plusTax={env.STRIPE_AUTOMATIC_TAX} /> : null}
      {sub?.customerId ? <ManageBilling clientId={clientId} /> : null}
      <DangerZone clientId={clientId} businessName={client.name} isAdmin={editAccess.isAdmin} hasBilling={Boolean(sub?.customerId)} />
    </div>
  );
}
