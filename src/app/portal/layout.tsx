import Link from "next/link";
import { Phone } from "lucide-react";
import { getPortalEditAccess, resolvePortalClient } from "@/lib/auth-guard";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import { countUnreadMessages } from "@/lib/data/sms-messages";
import { PortalSidebar, PortalTabBar } from "@/components/portal/portal-nav";
import { UserMenuButton } from "@/components/user-menu-button";
import { CommandPalette } from "@/components/command-palette";
import { ChatBubble } from "@/components/portal/chat-bubble";
import { LiveCallStrip } from "@/components/portal/live-call-strip";
import { env, integrations } from "@/lib/env";
import { getTrialState } from "@/lib/data/trial";
import { getTrialProgress } from "@/lib/data/trial-progress";
import { daysLeftLabel, trialStripSummary, upgradePlan } from "@/lib/trial-progress";
import { formatCurrencyCents } from "@/lib/format";
import { TrialStrip } from "@/components/portal/trial-strip";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const { clientId, preview } = await resolvePortalClient();
  const [client, unreadMessages] = await Promise.all([
    getClientByIdUnsafe(clientId),
    // Never throws (0 until the sms_messages migration has run).
    countUnreadMessages(clientId),
  ]);
  const showTeam = Boolean(client && (client.staffModeEnabled || client.companySize !== "solo"));

  // Trial countdown on every page (the Overview has the full card instead).
  const trial = await getTrialState(clientId);
  let strip: React.ComponentProps<typeof TrialStrip> | null = null;
  if (client && (trial.active || trial.expired)) {
    const [progress, access] = await Promise.all([
      getTrialProgress(clientId),
      getPortalEditAccess(clientId),
    ]);
    const plan = upgradePlan(client.setupFlags?.intendedPlan);
    strip = {
      headline: trial.expired ? "Your free trial has ended — your AI is still answering" : daysLeftLabel(trial.daysLeft),
      shortHeadline: trial.expired
        ? "Free trial ended"
        : trial.daysLeft <= 0
          ? "Last day of trial"
          : `${trial.daysLeft} day${trial.daysLeft === 1 ? "" : "s"} left in trial`,
      summary: progress ? trialStripSummary(progress) : null,
      urgent: trial.expired || trial.daysLeft <= 3,
      upgrade:
        !preview && access.isAdmin && integrations.stripe()
          ? { clientId, planKey: plan.key, label: `Upgrade · ${formatCurrencyCents(plan.monthlyPriceCents)}/mo` }
          : null,
    };
  }

  return (
    <div data-fd-app="portal" className="flex min-h-screen flex-col">
      {preview ? (
        <div className="flex items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-500/15 px-4 py-2 text-sm text-amber-800 dark:text-amber-300 sm:px-6">
          <span>
            Operator preview — this is the portal exactly as{" "}
            <strong>{client?.name ?? "this client"}</strong> sees it (their data only).
          </span>
          <Link
            href="/exit-preview"
            className="shrink-0 font-medium underline underline-offset-2"
            prefetch={false}
          >
            Exit preview
          </Link>
        </div>
      ) : null}
      <header className="fd-header sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur sm:px-6">
        <div
          className="fd-mark flex size-8 items-center justify-center rounded-lg text-white"
          style={{ background: "linear-gradient(135deg,#6a3df5,#0e7490)" }}
        >
          <Phone className="size-4" />
        </div>
        <div className="min-w-0">
          <p className="truncate font-heading text-sm font-semibold leading-tight">
            {client?.name ?? "Your business"}
          </p>
          <p className="text-xs font-medium tracking-wide text-muted-foreground leading-tight">FrontDesk AI</p>
        </div>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <CommandPalette portal />
          <UserMenuButton />
        </div>
      </header>
      <LiveCallStrip clientId={clientId} />
      {strip ? <TrialStrip {...strip} /> : null}
      <div className="flex flex-1">
        {/* Desktop: grouped left rail. Phones use the bottom tab bar below. */}
        <aside className="hidden w-60 shrink-0 border-r border-border/70 bg-card/40 md:block">
          <div className="sticky top-16 max-h-[calc(100vh-4rem)] overflow-y-auto px-3 py-6">
            <PortalSidebar showTeam={showTeam} unreadMessages={unreadMessages} />
          </div>
        </aside>
        <main className="min-w-0 flex-1 p-4 pb-24 sm:p-6 sm:pb-24 md:pb-8 lg:p-8">
          <div className="fd-fade-up mx-auto w-full max-w-5xl">{children}</div>
        </main>
      </div>
      <PortalTabBar showTeam={showTeam} unreadMessages={unreadMessages} />
      {client?.chatWidgetEnabled ? (
        <ChatBubble clientId={clientId} appUrl={env.APP_URL.replace(/\/$/, "")} />
      ) : null}
      <footer className="border-t border-border/70 px-4 py-4 text-center text-xs text-muted-foreground sm:px-6">
        FrontDesk AI ·{" "}
        <Link
          href="/terms"
          target="_blank"
          className="underline-offset-2 hover:text-foreground hover:underline"
        >
          Terms
        </Link>{" "}
        ·{" "}
        <Link
          href="/privacy"
          target="_blank"
          className="underline-offset-2 hover:text-foreground hover:underline"
        >
          Privacy
        </Link>
      </footer>
    </div>
  );
}
