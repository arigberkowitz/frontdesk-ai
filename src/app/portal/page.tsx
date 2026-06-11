import type { Metadata } from "next";
import Link from "next/link";
import { MessageSquare, Sparkles } from "lucide-react";
import { resolvePortalClient } from "@/lib/auth-guard";
import { getClientMetrics } from "@/lib/data/metrics";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import { listAppointments } from "@/lib/data/appointments";
import { listCalls } from "@/lib/data/calls";
import { PageHeader } from "@/components/page-header";
import { MetricCard } from "@/components/metric-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CallsChart } from "@/components/charts/calls-chart";
import { OutcomesChart } from "@/components/charts/outcomes-chart";
import { formatCurrencyCents, formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Overview" };

export default async function PortalOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ onboarded?: string }>;
}) {
  const { onboarded } = await searchParams;
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

      {m.newLeads > 0 ? (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex items-start gap-3 p-4 text-sm">
            <MessageSquare className="mt-0.5 size-5 shrink-0 text-amber-600" />
            <div>
              <p className="font-medium">
                {m.newLeads} new message{m.newLeads === 1 ? "" : "s"} for you
              </p>
              <p className="text-muted-foreground">
                Someone left a message your AI couldn&apos;t book.{" "}
                <Link
                  href="/portal/leads"
                  className="font-medium text-foreground underline underline-offset-2"
                >
                  View messages →
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {onboarded ? (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex items-start gap-3 p-4 text-sm">
            <Sparkles className="mt-0.5 size-5 shrink-0 text-primary" />
            <div>
              <p className="font-medium">We drafted your receptionist from your website.</p>
              <p className="text-muted-foreground">
                Review your <strong>Services</strong>, <strong>Hours</strong>, and <strong>FAQ</strong>{" "}
                tabs, set the greeting and voice under <strong>Your AI</strong>, then activate it. Edit
                anything that&apos;s off — nothing goes live until you activate.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Revenue captured" value={formatCurrencyCents(m.estRevenueCents)} href="/portal/appointments" breakdown={revenueBreakdown} />
        <MetricCard label="Calls answered" value={String(m.totalCalls)} href="/portal/calls" breakdown={callsBreakdown} />
        <MetricCard label="Appointments booked" value={String(m.bookings)} href="/portal/appointments" breakdown={apptBreakdown} />
        <MetricCard label="After-hours saves" value={String(m.afterHoursCalls)} href="/portal/calls" breakdown={afterHoursBreakdown} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Calls and bookings — last 14 days</CardTitle>
          </CardHeader>
          <CardContent>
            <CallsChart data={m.callsByDay} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>What happened on your calls</CardTitle>
          </CardHeader>
          <CardContent>
            <OutcomesChart data={m.outcomes} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
