import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Eye, Sparkles } from "lucide-react";
import { requireOperator } from "@/lib/auth-guard";
import { getClient } from "@/lib/data/clients";
import { listCalls } from "@/lib/data/calls";
import { listAppointments } from "@/lib/data/appointments";
import { listLeads } from "@/lib/data/leads";
import { getClientMetrics } from "@/lib/data/metrics";
import { listRetellVoices } from "@/lib/retell";
import { integrations } from "@/lib/env";
import type { VoiceMeta } from "@/config/voice";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/clients/status-badge";
import { ClientDetail } from "@/components/clients/client-detail";

export default async function ClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ onboarded?: string }>;
}) {
  const { id } = await params;
  const { onboarded } = await searchParams;
  const user = await requireOperator();
  const client = await getClient(user.orgId, id);
  if (!client) notFound();

  const [calls, appointments, leads, metrics] = await Promise.all([
    listCalls(id),
    listAppointments(id),
    listLeads(id),
    getClientMetrics(id),
  ]);

  // Best-effort: load the live Retell voice library for the picker. Never block
  // the page on it — without a key (or on an API hiccup) we fall back to curated.
  let voices: VoiceMeta[] = [];
  if (integrations.retell()) {
    try {
      voices = await listRetellVoices();
    } catch {
      voices = [];
    }
  }

  return (
    <div className="space-y-6">
      <Button
        variant="ghost"
        size="sm"
        render={<Link href="/clients" />}
        nativeButton={false}
        className="-ml-2"
      >
        <ArrowLeft className="size-4" />
        Clients
      </Button>
      <PageHeader title={client.name} description={client.industry ?? undefined}>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            render={<Link href={`/clients/${id}/preview-portal`} prefetch={false} />}
            nativeButton={false}
          >
            <Eye className="size-4" />
            Preview portal
          </Button>
          <StatusBadge status={client.status} />
        </div>
      </PageHeader>
      {onboarded ? (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex items-start gap-3 p-4">
            <Sparkles className="mt-0.5 size-5 shrink-0 text-primary" />
            <div className="text-sm">
              <p className="font-medium">Drafted from the website.</p>
              <p className="text-muted-foreground">
                Review the services, hours, and FAQ below, edit anything that’s off, then provision
                the agent on the <span className="font-medium">Agent</span> tab. Nothing is published
                until you provision.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}
      <ClientDetail
        client={client}
        services={client.services}
        hours={client.businessHours}
        knowledge={client.knowledgeItems}
        calls={calls}
        appointments={appointments}
        leads={leads}
        metrics={metrics}
        retellReady={integrations.retell()}
        voices={voices}
      />
    </div>
  );
}
