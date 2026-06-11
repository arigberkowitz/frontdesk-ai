import type { Metadata } from "next";
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

  const revenueBreakdown = [
    "Estimated value of the appointments your AI booked.",
    ...(m.bookings > 0 && m.avgServicePriceCents != null
      ? [
          `${m.bookings} booking${m.bookings === 1 ? "" : "s"} × ${formatCurrencyCents(m.avgServicePriceCents)} avg service price`,
          `= ${formatCurrencyCents(m.estRevenueCents)}`,
        ]
      : ["No bookings yet this period."]),
  ];
  const callsBreakdown = [
    "Every call your AI answered, by what happened on it.",
    `${m.bookings} booked an appointment`,
    `${m.leads} left a message`,
    `${answered} got a question answered`,
  ];
  const apptBreakdown = [
    "The appointments your AI put on the calendar.",
    ...(appts.length
      ? appts.slice(0, 4).map((a) => `${a.customerName ?? "Caller"} — ${formatDateTime(a.startAt, tz)}`)
      : ["No appointments yet."]),
  ];
  const afterHoursBreakdown = [
    "Calls your AI caught outside your open hours — ones you'd likely have missed.",
    ...(afterHours.length
      ? afterHours.slice(0, 4).map((c) => `Call at ${formatDateTime(c.startAt, tz)}`)
      : ["None yet — your AI caught everything during open hours."]),
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Your AI receptionist"
        description="Here's what it caught for you. Tap any number for the details."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Revenue captured" value={formatCurrencyCents(m.estRevenueCents)} href="/portal/appointments" breakdown={revenueBreakdown} />
        <MetricCard label="Calls answered" value={String(m.totalCalls)} href="/portal/calls" breakdown={callsBreakdown} />
        <MetricCard label="Appointments booked" value={String(m.bookings)} href="/portal/appointments" breakdown={apptBreakdown} />
        <MetricCard label="After-hours saves" value={String(m.afterHoursCalls)} href="/portal/calls" breakdown={afterHoursBreakdown} />
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
