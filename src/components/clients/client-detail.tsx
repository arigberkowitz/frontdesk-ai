"use client";

import { CalendarCheck, Download, Inbox } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LeadStatusControl } from "@/components/clients/lead-status-control";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "@/components/metric-card";
import { EmptyState } from "@/components/empty-state";
import { CallsChart } from "@/components/charts/calls-chart";
import { OutcomesChart } from "@/components/charts/outcomes-chart";
import { CallsTable } from "@/components/clients/calls-table";
import type { ClientMetrics } from "@/lib/data/metrics";
import { ServicesTab } from "@/components/clients/services-tab";
import { HoursTab } from "@/components/clients/hours-tab";
import { KnowledgeTab } from "@/components/clients/knowledge-tab";
import { AgentConfigTab } from "@/components/clients/agent-config-tab";
import { SettingsTab } from "@/components/clients/settings-tab";
import type { BillingInfo } from "@/components/clients/billing-card";
import { formatCurrencyCents, formatPercent, formatPhone } from "@/lib/format";
import { clientMetricBreakdowns } from "@/lib/metric-breakdowns";
import { AppointmentsView } from "@/components/appointments-view";
import { NewAppointmentDialog } from "@/components/portal/new-appointment-dialog";
import { vocabFor } from "@/lib/vocab";
import type { VoiceMeta } from "@/config/voice";
import type {
  Appointment,
  BusinessHour,
  Call,
  Client,
  KnowledgeItem,
  Lead,
  Service,
} from "@/db/schema";

type AppointmentWithService = Appointment & { service: Service | null };

interface Props {
  client: Client;
  services: Service[];
  hours: BusinessHour[];
  knowledge: KnowledgeItem[];
  calls: Call[];
  appointments: AppointmentWithService[];
  /** Active team members (staff mode) for assigning manual appointments. */
  providers: { id: string; name: string }[];
  leads: Lead[];
  metrics: ClientMetrics;
  retellReady: boolean;
  voices: VoiceMeta[];
  billing: BillingInfo;
  intakeUrl: string;
}

function sentimentLabel(score: number | null): string {
  if (score == null) return "—";
  if (score > 0.2) return "Positive";
  if (score < -0.2) return "Negative";
  return "Neutral";
}

function ExportCsvButton({
  clientId,
  type,
}: {
  clientId: string;
  type: "calls" | "appointments" | "leads";
}) {
  return (
    <div className="flex justify-end">
      <Button
        variant="outline"
        size="sm"
        nativeButton={false}
        render={<a href={`/api/clients/${clientId}/export?type=${type}`} download />}
      >
        <Download className="size-4" />
        Export CSV
      </Button>
    </div>
  );
}

const TABS = [
  "overview",
  "calls",
  "appointments",
  "leads",
  "services",
  "hours",
  "knowledge",
  "agent",
  "settings",
] as const;

export function ClientDetail(props: Props) {
  const {
    client,
    services,
    hours,
    knowledge,
    calls,
    appointments,
    providers,
    leads,
    metrics,
    retellReady,
    voices,
    billing,
    intakeUrl,
  } = props;

  const bd = clientMetricBreakdowns(metrics);
  const v = vocabFor(client.industry);

  return (
    <Tabs defaultValue="overview">
      <div className="overflow-x-auto">
        <TabsList className="mb-4">
          {TABS.map((t) => (
            <TabsTrigger key={t} value={t} className="capitalize">
              {t}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      <TabsContent value="overview" className="space-y-6">
        <div className="fd-stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard icon="revenue" label="Revenue captured" value={formatCurrencyCents(metrics.estRevenueCents)} sub={metrics.upcomingRevenueCents > 0 ? `+ ${formatCurrencyCents(metrics.upcomingRevenueCents)} booked ahead` : undefined} hint="Earned once the appointment happens" breakdown={bd.revenue} spark={metrics.callsByDay.map((d) => d.bookings)} sparkColor="#10b981" />
          <MetricCard icon="calls" label="Calls" value={String(metrics.totalCalls)} hint="All time" breakdown={bd.calls} spark={metrics.callsByDay.map((d) => d.calls)} sparkColor="#0ea5e9" />
          <MetricCard icon="bookings" label="Bookings" value={String(metrics.bookings)} breakdown={bd.bookings} spark={metrics.callsByDay.map((d) => d.bookings)} sparkColor="#10b981" />
          <MetricCard icon="afterHours" label="After-hours saves" value={String(metrics.afterHoursCalls)} breakdown={bd.afterHours} />
          <MetricCard icon="containment" label="Containment" value={formatPercent(metrics.containmentRate)} hint="Handled without a human" breakdown={bd.containment} />
          <MetricCard icon="answerRate" label="Answer rate" value={formatPercent(metrics.answerRate)} breakdown={bd.answerRate} />
          <MetricCard icon="leads" label="Leads" value={String(metrics.leads)} breakdown={bd.leads} />
          <MetricCard icon="sentiment" label="Sentiment" value={sentimentLabel(metrics.sentimentScore)} breakdown={bd.sentiment} />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Calls and bookings — last 14 days</CardTitle>
            </CardHeader>
            <CardContent>
              <CallsChart data={metrics.callsByDay} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>What happened on calls</CardTitle>
            </CardHeader>
            <CardContent>
              <OutcomesChart data={metrics.outcomes} />
            </CardContent>
          </Card>
        </div>
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground">Recent calls</h3>
          <CallsTable clientId={client.id} calls={calls.slice(0, 5)} timezone={client.timezone} />
        </div>
      </TabsContent>

      <TabsContent value="calls" className="space-y-3">
        {calls.length > 0 ? <ExportCsvButton clientId={client.id} type="calls" /> : null}
        <CallsTable clientId={client.id} calls={calls} timezone={client.timezone} />
      </TabsContent>

      <TabsContent value="appointments" className="space-y-3">
        <div className="flex items-center gap-2">
          <NewAppointmentDialog
            clientId={client.id}
            services={services
              .filter((s) => s.isActive)
              .map((s) => ({ id: s.id, name: s.name, durationMin: s.durationMin }))}
            providers={providers}
            vocab={{ customer: v.customer, appointment: v.appointment }}
          />
          {appointments.length > 0 ? (
            <ExportCsvButton clientId={client.id} type="appointments" />
          ) : null}
        </div>
        {appointments.length === 0 ? (
          <EmptyState icon={CalendarCheck} title="No appointments yet" />
        ) : (
          <AppointmentsView
            appointments={appointments.map((a) => ({
              id: a.id,
              callId: a.callId,
              customerName: a.customerName,
              customerPhone: a.customerPhone,
              startAt: a.startAt,
              endAt: a.endAt,
              status: a.status,
              serviceName: a.service?.name ?? null,
            }))}
            callBasePath={`/clients/${client.id}/calls`}
            clientId={client.id}
            timeZone={client.timezone}
          />
        )}
      </TabsContent>

      <TabsContent value="leads" className="space-y-3">
        {leads.length > 0 ? <ExportCsvButton clientId={client.id} type="leads" /> : null}
        {leads.length === 0 ? (
          <EmptyState icon={Inbox} title="No leads yet" />
        ) : (
          <ul className="divide-y rounded-xl border">
            {leads.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-medium">{l.name ?? "Caller"}</p>
                  <p className="text-sm text-muted-foreground">
                    {formatPhone(l.phone)}
                    {l.reason ? ` · ${l.reason}` : ""}
                    {l.message ? ` — "${l.message}"` : ""}
                  </p>
                </div>
                <LeadStatusControl leadId={l.id} clientId={client.id} status={l.status} />
              </li>
            ))}
          </ul>
        )}
      </TabsContent>

      <TabsContent value="services">
        <ServicesTab clientId={client.id} services={services} />
      </TabsContent>
      <TabsContent value="hours">
        <HoursTab clientId={client.id} hours={hours} />
      </TabsContent>
      <TabsContent value="knowledge">
        <KnowledgeTab clientId={client.id} knowledge={knowledge} />
      </TabsContent>
      <TabsContent value="agent">
        <AgentConfigTab client={client} retellReady={retellReady} voices={voices} />
      </TabsContent>
      <TabsContent value="settings">
        <SettingsTab client={client} billing={billing} intakeUrl={intakeUrl} />
      </TabsContent>
    </Tabs>
  );
}
