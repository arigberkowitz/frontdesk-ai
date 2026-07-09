import type { Metadata } from "next";
import Link from "next/link";
import { MessageSquare, Sparkles } from "lucide-react";
import { resolvePortalClient } from "@/lib/auth-guard";
import { getClientMetrics, getClientRoi, getClientWeeklyRecap } from "@/lib/data/metrics";
import { getClientSetupStatus } from "@/lib/data/setup";
import { getClientActivity } from "@/lib/data/activity";
import { listOpenSuggestions } from "@/lib/data/suggestions";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import { listAppointments } from "@/lib/data/appointments";
import { listCalls } from "@/lib/data/calls";
import { getFollowUpsForClient } from "@/lib/data/follow-ups";
import { PageHeader } from "@/components/page-header";
import { MetricCard } from "@/components/metric-card";
import { Card, CardContent } from "@/components/ui/card";
import { CallActivity } from "@/components/portal/call-activity";
import { RoiPanel } from "@/components/portal/roi-panel";
import { SetupChecklist } from "@/components/portal/setup-checklist";
import { WeeklyRecap } from "@/components/portal/weekly-recap";
import { ActivityFeed } from "@/components/portal/activity-feed";
import { AiLearnings } from "@/components/portal/ai-learnings";
import { CopilotChat } from "@/components/portal/copilot-chat";
import { formatCurrencyCents, formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Overview" };

export default async function PortalOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ onboarded?: string }>;
}) {
  const { onboarded } = await searchParams;
  const { clientId } = await resolvePortalClient();
  const [client, m, appts, callsList, followUps, roi, setup, recap, activity, learnings] =
    await Promise.all([
      getClientByIdUnsafe(clientId),
      getClientMetrics(clientId),
      listAppointments(clientId),
      listCalls(clientId),
      getFollowUpsForClient(clientId),
      getClientRoi(clientId),
      getClientSetupStatus(clientId),
      getClientWeeklyRecap(clientId),
      getClientActivity(clientId),
      listOpenSuggestions(clientId),
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
            <MessageSquare className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
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

      <SetupChecklist status={setup} />

      <div className="fd-stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard icon="revenue" label="Revenue captured" value={formatCurrencyCents(m.estRevenueCents)} href="/portal/appointments" breakdown={revenueBreakdown} spark={m.callsByDay.map((d) => d.bookings)} sparkColor="#10b981" size="hero" className="sm:col-span-2" />
        <MetricCard icon="calls" label="Calls answered" value={String(m.totalCalls)} href="/portal/calls" breakdown={callsBreakdown} spark={m.callsByDay.map((d) => d.calls)} sparkColor="#0ea5e9" />
        <MetricCard icon="bookings" label="Appointments booked" value={String(m.bookings)} href="/portal/appointments" breakdown={apptBreakdown} spark={m.callsByDay.map((d) => d.bookings)} sparkColor="#10b981" />
        <MetricCard icon="afterHours" label="After-hours saves" value={String(m.afterHoursCalls)} href="/portal/calls" breakdown={afterHoursBreakdown} className="sm:col-span-2 lg:col-span-1" />
      </div>

      <AiLearnings clientId={clientId} suggestions={learnings} />

      <RoiPanel roi={roi} />

      <WeeklyRecap recap={recap} />

      <CallActivity
        trend={m.callsByDay}
        outcomes={m.outcomes}
        followUps={followUps}
        clientId={clientId}
        tz={tz}
      />

      <CopilotChat />

      <ActivityFeed items={activity} />
    </div>
  );
}
