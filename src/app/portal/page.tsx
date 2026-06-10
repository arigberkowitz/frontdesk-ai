import type { Metadata } from "next";
import { CalendarCheck, Clock, Phone, TrendingUp } from "lucide-react";
import { resolvePortalClient } from "@/lib/auth-guard";
import { getClientMetrics } from "@/lib/data/metrics";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import { listAppointments } from "@/lib/data/appointments";
import { listCalls } from "@/lib/data/calls";
import { PageHeader } from "@/components/page-header";
import { MetricCard } from "@/components/metric-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CallsChart } from "@/components/charts/calls-chart";
import { formatCurrencyCents, formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Overview" };

export default async function PortalOverviewPage() {
  const { clientId } = await resolvePortalClient();
  const [client, m, appts, callsList] = await Promise.all([
    getClientByIdUnsafe(clientId),
    getClientMetrics(clientId),
    listAppointments(clientId),
    listCalls(clientId),
  ]);
  const tz = client?.timezone;
  const answered = Math.max(0, m.totalCalls - m.bookings - m.leads);
  const afterHours = callsList.filter((c) => c.isAfterHours && c.startAt);

  const revenueBreakdown =
    m.bookings > 0 && m.avgServicePriceCents != null
      ? [`${m.bookings} booking${m.bookings === 1 ? "" : "s"} × ${formatCurrencyCents(m.avgServicePriceCents)} avg`]
      : ["No bookings yet this period."];
  const callsBreakdown = [
    `${m.bookings} booked`,
    `${m.leads} lead${m.leads === 1 ? "" : "s"}`,
    `${answered} question${answered === 1 ? "" : "s"} answered`,
  ];
  const apptBreakdown = appts.length
    ? appts.slice(0, 4).map((a) => `${a.customerName ?? "Caller"} — ${formatDateTime(a.startAt, tz)}`)
    : ["No appointments yet."];
  const afterHoursBreakdown = afterHours.length
    ? afterHours.slice(0, 4).map((c) => `1 call at ${formatDateTime(c.startAt, tz)}`)
    : ["None — your AI caught everything during open hours."];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Your AI receptionist"
        description="Here's what it caught for you. Tap any number for the details."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Revenue captured"
          value={formatCurrencyCents(m.estRevenueCents)}
          icon={TrendingUp}
          href="/portal/appointments"
          breakdown={revenueBreakdown}
        />
        <MetricCard
          label="Calls answered"
          value={String(m.totalCalls)}
          icon={Phone}
          href="/portal/calls"
          breakdown={callsBreakdown}
        />
        <MetricCard
          label="Appointments booked"
          value={String(m.bookings)}
          icon={CalendarCheck}
          href="/portal/appointments"
          breakdown={apptBreakdown}
        />
        <MetricCard
          label="After-hours saves"
          value={String(m.afterHoursCalls)}
          icon={Clock}
          href="/portal/calls"
          breakdown={afterHoursBreakdown}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Calls and bookings — last 14 days</CardTitle>
        </CardHeader>
        <CardContent>
          <CallsChart data={m.callsByDay} />
        </CardContent>
      </Card>
    </div>
  );
}
