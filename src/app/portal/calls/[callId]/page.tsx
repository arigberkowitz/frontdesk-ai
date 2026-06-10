import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { resolvePortalClient } from "@/lib/auth-guard";
import { getCallForClient } from "@/lib/data/calls";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, formatDuration, formatPhone } from "@/lib/format";
import { CALL_OUTCOME_LABELS } from "@/config/options";

export default async function PortalCallPage({
  params,
}: {
  params: Promise<{ callId: string }>;
}) {
  const { callId } = await params;
  const { clientId } = await resolvePortalClient();
  const call = await getCallForClient(clientId, callId);
  if (!call) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Button
        variant="ghost"
        size="sm"
        render={<Link href="/portal/calls" />}
        nativeButton={false}
        className="-ml-2"
      >
        <ArrowLeft className="size-4" />
        Calls
      </Button>

      <PageHeader title="Call detail" description={formatDateTime(call.startAt, call.client.timezone)}>
        {call.outcome ? <Badge>{CALL_OUTCOME_LABELS[call.outcome]}</Badge> : null}
      </PageHeader>

      <div className="grid gap-3 sm:grid-cols-3">
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
