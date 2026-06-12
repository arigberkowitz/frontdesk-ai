import type { Metadata } from "next";
import Link from "next/link";
import { currentUser } from "@clerk/nextjs/server";
import { Building2, MessageSquare, Plus } from "lucide-react";
import { requireOperator } from "@/lib/auth-guard";
import { getPortfolioMetrics } from "@/lib/data/metrics";
import { Greeting } from "@/components/greeting";
import { MetricCard } from "@/components/metric-card";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CallsChart } from "@/components/charts/calls-chart";
import { OutcomesChart } from "@/components/charts/outcomes-chart";
import { StatusBadge } from "@/components/clients/status-badge";
import { formatCurrencyCents } from "@/lib/format";
import type { ClientStatus } from "@/db/schema";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await requireOperator();
  const [m, cu] = await Promise.all([getPortfolioMetrics(user.orgId), currentUser()]);
  const firstName = cu?.firstName ?? undefined;

  const money = formatCurrencyCents;
  const perClientOverhead = m.activeClients ? Math.round(m.overheadCents / m.activeClients) : 0;
  const clientsWithNew = m.clients.filter((c) => c.newLeads > 0);

  const revenueBreakdown = [
    "Estimated booking revenue captured this month.",
    `${m.bookingsThisMonth} booking${m.bookingsThisMonth === 1 ? "" : "s"} this month × ${money(m.avgServiceCents)} avg service price`,
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
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
            <Greeting name={firstName} />
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Your book of business at a glance.</p>
        </div>
        <Button render={<Link href="/clients/new" />} nativeButton={false}>
          <Plus className="size-4" />
          New client
        </Button>
      </div>

      {m.newLeads > 0 ? (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex items-start gap-3 p-4">
            <MessageSquare className="mt-0.5 size-5 shrink-0 text-amber-600" />
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard icon="revenue" label="Revenue captured" value={money(m.estRevenueMonthCents)} hint="Bookings × avg price, this month" href="/clients" breakdown={revenueBreakdown} />
        <MetricCard icon="clients" label="Active clients" value={String(m.activeClients)} hint="Live + trial" href="/clients" breakdown={activeBreakdown} />
        <MetricCard icon="calls" label="Calls today" value={String(m.callsToday)} hint="Across all clients" href="/clients" breakdown={callsTodayBreakdown} />
        <MetricCard icon="bookings" label="Bookings today" value={String(m.bookingsToday)} hint="Appointments captured" href="/clients" breakdown={bookingsTodayBreakdown} />
        <MetricCard icon="afterHours" label="After-hours saves" value={String(m.afterHoursThisWeek)} hint="This week" breakdown={afterHoursBreakdown} />
        <MetricCard icon="mrr" label="MRR" value={money(m.mrrCents)} hint="Recurring revenue" href="/clients" breakdown={mrrBreakdown} />
        <MetricCard icon="margin" label="Est. margin" value={money(m.marginCents)} hint="Price − vendor cost, this month" breakdown={marginBreakdown} />
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
            <h2 className="text-sm font-medium text-muted-foreground">Clients</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {m.clients.map((c) => (
              <Link key={c.id} href={`/clients/${c.id}`}>
                <Card className="transition-colors hover:border-primary/40">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate font-medium">{c.name}</p>
                      <StatusBadge status={c.status as ClientStatus} />
                    </div>
                    <div className="mt-3 flex gap-4 text-sm text-muted-foreground">
                      <span>
                        <span className="font-medium text-foreground tabular-nums">{c.callsToday}</span> today
                      </span>
                      <span>
                        <span className="font-medium text-foreground tabular-nums">{c.totalCalls}</span> calls
                      </span>
                      <span>
                        <span className="font-medium text-foreground tabular-nums">{c.bookings}</span> booked
                      </span>
                      {c.newLeads > 0 ? (
                        <span className="font-medium text-amber-600 tabular-nums">{c.newLeads} new</span>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
