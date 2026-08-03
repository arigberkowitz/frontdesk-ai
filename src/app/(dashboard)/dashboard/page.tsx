import type { Metadata } from "next";
import Link from "next/link";
import { currentUser } from "@clerk/nextjs/server";
import { Building2, MessageSquare, Plus } from "lucide-react";
import { requireOperator } from "@/lib/auth-guard";
import { getOrgCallQuality, getPortfolioMetrics } from "@/lib/data/metrics";
import { getAgentActivity } from "@/lib/data/agent-runs";
import { countOpenGrades } from "@/lib/agents/qa";
import { AgentActivityPanel } from "@/components/agent-activity";
import { Greeting } from "@/components/greeting";
import { PageHeader } from "@/components/page-header";
import { MetricCard } from "@/components/metric-card";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CallsChart } from "@/components/charts/calls-chart";
import { OutcomesChart } from "@/components/charts/outcomes-chart";
import { ClientSummaryCard } from "@/components/clients/client-summary-card";
import { TrialsCard, type TrialRow } from "@/components/trials-card";
import { formatCurrencyCents } from "@/lib/format";
import { db } from "@/db";
import { clients, organizations } from "@/db/schema";
import { and, eq, isNotNull, isNull } from "drizzle-orm";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await requireOperator();
  const [m, cu, agentActivity, openReviews, quality] = await Promise.all([
    getPortfolioMetrics(user.orgId),
    currentUser(),
    getAgentActivity(user.orgId),
    countOpenGrades(user.orgId),
    getOrgCallQuality(user.orgId),
  ]);
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const firstName = cu?.firstName ?? undefined;

  // Free trials: the operator's access code + pending requests + running trials.
  const [org, trialPendingRows, trialActiveRows] = await Promise.all([
    db.query.organizations.findFirst({ where: eq(organizations.id, user.orgId) }),
    db.query.clients.findMany({
      where: and(
        eq(clients.orgId, user.orgId),
        isNotNull(clients.trialRequestedAt),
        isNull(clients.deletedAt),
      ),
    }),
    db.query.clients.findMany({
      where: and(eq(clients.orgId, user.orgId), eq(clients.status, "trial"), isNull(clients.deletedAt)),
    }),
  ]);
  const toTrialRow = (c: (typeof trialPendingRows)[number]): TrialRow => ({
    id: c.id,
    name: c.name,
    requestedAt: c.trialRequestedAt?.toISOString() ?? null,
    trialEndsAt: c.trialEndsAt?.toISOString() ?? null,
    status: c.status,
  });
  const trialPending = trialPendingRows.filter((c) => c.status !== "trial" && c.status !== "live").map(toTrialRow);
  const trialActive = trialActiveRows.map(toTrialRow);

  const money = formatCurrencyCents;
  const perClientOverhead = m.activeClients ? Math.round(m.overheadCents / m.activeClients) : 0;
  const clientsWithNew = m.clients.filter((c) => c.newLeads > 0);

  const revenueBreakdown = [
    "Appointments that have already happened this month, valued at the price of the service actually booked.",
    `${m.bookingsThisMonth} booking${m.bookingsThisMonth === 1 ? "" : "s"} made this month; only those whose time has passed count toward revenue.`,
    `= ${money(m.estRevenueMonthCents)}`,
  ];
  const activeClientsList = m.clients.filter((c) => c.status === "live" || c.status === "trial");
  const activeBreakdown = activeClientsList.length
    ? ["Clients on a live or trial plan:", ...activeClientsList.map((c) => `${c.name} — ${c.status}`)]
    : ["No live or trial clients yet."];
  const callsTodayBreakdown = [
    "Inbound calls your agents answered since midnight.",
    ...(m.clients.some((c) => c.callsToday > 0)
      ? m.clients.filter((c) => c.callsToday > 0).map((c) => `${c.name}: ${c.callsToday}`)
      : ["No calls yet today."]),
  ];
  const bookingsTodayBreakdown = [
    "Appointments booked today — counted when the booking was made, not when it's scheduled.",
    `${m.bookingsToday} booked today across your clients`,
  ];
  const afterHoursBreakdown = [
    "Calls answered outside business hours in the last 7 days — ones you'd likely have missed.",
    `${m.afterHoursThisWeek} after-hours call${m.afterHoursThisWeek === 1 ? "" : "s"} this week`,
  ];
  const mrrBreakdown = [
    "Recurring monthly revenue from clients on an active or trial plan.",
    ...(m.mrrByClient.length
      ? m.mrrByClient.map((s) => `${s.name} — ${money(s.cents)}/mo`)
      : ["No paid plans yet."]),
    `= ${money(m.mrrCents)}/mo`,
  ];
  const marginBreakdown = [
    "What you keep this month after vendor costs.",
    `MRR ${money(m.mrrCents)}`,
    `− Retell call costs ${money(m.retellCostMonthCents)}`,
    `− Overhead ${money(m.overheadCents)} (${m.activeClients} client${m.activeClients === 1 ? "" : "s"} × ${money(perClientOverhead)})`,
    `= ${money(m.marginCents)}`,
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={<Greeting name={firstName} />}
        description="Your book of business at a glance."
      >
        <Button render={<Link href="/clients/new" />} nativeButton={false}>
          <Plus className="size-4" />
          New client
        </Button>
      </PageHeader>

      <TrialsCard
        code={org?.trialAccessCode ?? null}
        pending={trialPending}
        active={trialActive}
      />

      {m.newLeads > 0 ? (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex items-start gap-3 p-4">
            <MessageSquare className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="text-sm">
              <p className="font-medium">
                {m.newLeads} new message{m.newLeads === 1 ? "" : "s"} waiting for follow-up
              </p>
              <p className="text-muted-foreground">
                {clientsWithNew.map((c, i) => (
                  <span key={c.id}>
                    {i > 0 ? " · " : ""}
                    <Link
                      href={`/clients/${c.id}`}
                      className="underline underline-offset-2 hover:text-foreground"
                    >
                      {c.name} ({c.newLeads})
                    </Link>
                  </span>
                ))}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="fd-stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard icon="revenue" label="Revenue captured" value={money(m.estRevenueMonthCents)} hint="Completed bookings this month, at each service's price" href="/clients" breakdown={revenueBreakdown} spark={m.callsByDay.map((d) => d.bookings)} sparkColor="#10b981" size="hero" className="sm:col-span-2" />
        <MetricCard icon="calls" label="Calls today" value={String(m.callsToday)} hint="Across all clients" href="/clients" breakdown={callsTodayBreakdown} spark={m.callsByDay.map((d) => d.calls)} sparkColor="#0ea5e9" />
        <MetricCard icon="bookings" label="Bookings today" value={String(m.bookingsToday)} hint="Appointments captured" href="/clients" breakdown={bookingsTodayBreakdown} spark={m.callsByDay.map((d) => d.bookings)} sparkColor="#10b981" />
      </div>

      <AgentActivityPanel activity={agentActivity} openReviews={openReviews} />

      {quality.totalCalls > 0 ? (
        <div className="space-y-3">
          <h2 className="fd-section-label">Call quality — last 30 days</h2>
          <div className="fd-stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              icon="answerRate"
              label="Answer rate"
              value={pct(quality.answerRate)}
              hint={`${quality.totalCalls} calls`}
              size="sm"
            />
            <MetricCard
              icon="containment"
              label="Containment"
              value={pct(quality.containmentRate)}
              hint="Handled without a human"
              size="sm"
            />
            <MetricCard
              icon="sentiment"
              label="Positive callers"
              value={quality.knownSentiments > 0 ? pct(quality.positiveShare) : "—"}
              hint={
                quality.knownSentiments > 0
                  ? `Of ${quality.knownSentiments} rated calls`
                  : "No sentiment data yet"
              }
              size="sm"
            />
            <MetricCard
              icon="qa"
              label="Avg QA score"
              value={quality.avgQaScore != null ? `${quality.avgQaScore.toFixed(1)}/5` : "—"}
              hint={
                quality.gradedCalls > 0
                  ? `${quality.gradedCalls} calls graded overnight`
                  : "QA agent hasn't graded calls yet"
              }
              size="sm"
            />
          </div>
        </div>
      ) : null}

      <div className="space-y-3">
        <h2 className="fd-section-label">Business health</h2>
        <div className="fd-stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard icon="clients" label="Active clients" value={String(m.activeClients)} hint="Live + trial" href="/clients" breakdown={activeBreakdown} size="sm" />
          <MetricCard icon="mrr" label="MRR" value={money(m.mrrCents)} hint="Recurring revenue" href="/clients" breakdown={mrrBreakdown} size="sm" />
          <MetricCard icon="margin" label="Est. margin" value={money(m.marginCents)} hint="Price − vendor cost, this month" breakdown={marginBreakdown} size="sm" />
          <MetricCard icon="afterHours" label="After-hours saves" value={String(m.afterHoursThisWeek)} hint="This week" breakdown={afterHoursBreakdown} size="sm" />
        </div>
      </div>

      {m.clients.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyState
              icon={Building2}
              title="No clients yet"
              description="Onboard your first business — draft the AI from its website in minutes."
            >
              <Button render={<Link href="/clients/new" />} nativeButton={false} variant="outline">
                <Plus className="size-4" />
                Add a client
              </Button>
            </EmptyState>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Calls &amp; bookings — last 14 days</CardTitle>
              </CardHeader>
              <CardContent>
                <CallsChart data={m.callsByDay} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>What happened on calls</CardTitle>
              </CardHeader>
              <CardContent>
                <OutcomesChart data={m.outcomes} />
              </CardContent>
            </Card>
          </div>
          <div className="space-y-3">
            <h2 className="fd-section-label">Clients</h2>
            <div className="fd-stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {m.clients.map((c) => (
                <ClientSummaryCard key={c.id} client={c} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
