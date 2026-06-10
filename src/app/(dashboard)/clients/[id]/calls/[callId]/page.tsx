import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarCheck, Inbox } from "lucide-react";
import { requireOperator } from "@/lib/auth-guard";
import { getCall } from "@/lib/data/calls";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, formatDuration, formatPhone } from "@/lib/format";
import { CALL_OUTCOME_LABELS } from "@/config/options";

export default async function CallPage({
  params,
}: {
  params: Promise<{ id: string; callId: string }>;
}) {
  const { id, callId } = await params;
  const user = await requireOperator();
  const call = await getCall(user.orgId, callId);
  if (!call || call.clientId !== id) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Button
        variant="ghost"
        size="sm"
        render={<Link href={`/clients/${id}`} />}
        nativeButton={false}
        className="-ml-2"
      >
        <ArrowLeft className="size-4" />
        {call.client.name}
      </Button>

      <PageHeader title="Call detail" description={formatDateTime(call.startAt, call.client.timezone)}>
        {call.outcome ? <Badge>{CALL_OUTCOME_LABELS[call.outcome]}</Badge> : null}
      </PageHeader>

      <div className="grid gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">From</p>
            <p className="font-medium">{formatPhone(call.fromNumber)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Length</p>
            <p className="font-medium">{formatDuration(call.durationSec)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Sentiment</p>
            <p className="font-medium capitalize">{call.sentiment ?? "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">After hours</p>
            <p className="font-medium">{call.isAfterHours ? "Yes" : "No"}</p>
          </CardContent>
        </Card>
      </div>

      {call.recordingUrl ? (
        <Card>
          <CardHeader>
            <CardTitle>Recording</CardTitle>
          </CardHeader>
          <CardContent>
            <audio controls src={call.recordingUrl} className="w-full" />
          </CardContent>
        </Card>
      ) : null}

      {call.summary ? (
        <Card>
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed text-muted-foreground">{call.summary}</p>
          </CardContent>
        </Card>
      ) : null}

      {call.appointments.length > 0 || call.leads.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {call.appointments.map((a) => (
            <Card key={a.id}>
              <CardContent className="flex items-center gap-3 p-4">
                <CalendarCheck className="size-5 text-emerald-600" />
                <div>
                  <p className="font-medium">Booked: {a.customerName ?? "Caller"}</p>
                  <p className="text-sm text-muted-foreground">
                    {formatDateTime(a.startAt, call.client.timezone)}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
          {call.leads.map((l) => (
            <Card key={l.id}>
              <CardContent className="flex items-center gap-3 p-4">
                <Inbox className="size-5 text-blue-600" />
                <div>
                  <p className="font-medium">Lead: {l.name ?? "Caller"}</p>
                  <p className="text-sm text-muted-foreground">{formatPhone(l.phone)}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Transcript</CardTitle>
        </CardHeader>
        <CardContent>
          {call.transcript ? (
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-muted-foreground">
              {call.transcript}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground">No transcript captured.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
