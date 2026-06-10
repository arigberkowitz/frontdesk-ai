import type { Metadata } from "next";
import Link from "next/link";
import {
  Building2,
  CalendarCheck,
  Clock,
  DollarSign,
  Phone,
  Plus,
  TrendingUp,
} from "lucide-react";
import { requireOperator } from "@/lib/auth-guard";
import { getPortfolioMetrics } from "@/lib/data/metrics";
import { PageHeader } from "@/components/page-header";
import { MetricCard } from "@/components/metric-card";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/clients/status-badge";
import { formatCurrencyCents } from "@/lib/format";
import type { ClientStatus } from "@/db/schema";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await requireOperator();
  const m = await getPortfolioMetrics(user.orgId);

  const activeBreakdown = m.clients.length
    ? m.clients.map((c) => `${c.name} — ${c.status}`)
    : ["No clients yet."];
  const callsTodayBreakdown = m.clients.some((c) => c.callsToday > 0)
    ? m.clients.filter((c) => c.callsToday > 0).map((c) => `${c.name}: ${c.callsToday}`)
    : ["No calls yet today."];

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" description="Your book of business at a glance.">
        <Button render={<Link href="/clients/new" />} nativeButton={false}>
          <Plus className="size-4" />
          New client
        </Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Revenue captured"
          value={formatCurrencyCents(m.estRevenueMonthCents)}
          hint="Bookings × avg price, this month"
          icon={TrendingUp}
          href="/clients"
        />
        <MetricCard label="Active clients" value={String(m.activeClients)} hint="Live + trial" icon={Building2} href="/clients" breakdown={activeBreakdown} />
        <MetricCard label="Calls today" value={String(m.callsToday)} hint="Across all clients" icon={Phone} href="/clients" breakdown={callsTodayBreakdown} />
        <MetricCard label="Bookings today" value={String(m.bookingsToday)} hint="Appointments captured" icon={CalendarCheck} href="/clients" />
        <MetricCard label="After-hours saves" value={String(m.afterHoursThisWeek)} hint="This week" icon={Clock} href="/clients" />
        <MetricCard label="MRR" value={formatCurrencyCents(m.mrrCents)} hint="Recurring revenue" icon={DollarSign} href="/clients" />
        <MetricCard label="Est. margin" value={formatCurrencyCents(m.marginCents)} hint="Price − vendor cost, this month" icon={TrendingUp} href="/clients" />
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
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
