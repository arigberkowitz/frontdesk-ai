import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarCheck, Clock, Smile, Sparkles, User } from "lucide-react";
import { resolvePortalClient } from "@/lib/auth-guard";
import { getCallForClient } from "@/lib/data/calls";
import { getInsightForCall } from "@/lib/data/insights";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CallAudioPlayer } from "@/components/portal/call-audio-player";
import { formatDateTime, formatDuration, formatPhone } from "@/lib/format";
import { CALL_OUTCOME_LABELS } from "@/config/options";

const SENTIMENT_LABEL: Record<string, string> = {
  positive: "Positive",
  neutral: "Neutral",
  negative: "Negative",
};

export default async function PortalCallPage({
  params,
}: {
  params: Promise<{ callId: string }>;
}) {
  const { callId } = await params;
  const { clientId } = await resolvePortalClient();
  const call = await getCallForClient(clientId, callId);
  if (!call) notFound();
  const insight = await getInsightForCall(clientId, callId);
  const entities = (insight?.entities ?? {}) as Record<string, string>;

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
            <CardTitle>Listen to the call</CardTitle>
          </CardHeader>
          <CardContent>
            <CallAudioPlayer src={call.recordingUrl} />
            <p className="mt-3 text-xs text-muted-foreground">
              Hear exactly how your AI handled this call.
            </p>
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

      {call.summary ? (
        <Card className="border-indigo-500/30">
          <CardContent className="p-5">
            <div className="mb-2.5 flex items-center gap-2">
              <Sparkles className="size-4 text-indigo-600 dark:text-indigo-400" />
              <span className="text-sm font-medium">AI summary</span>
            </div>
            <p className="text-sm leading-relaxed">{call.summary}</p>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {call.outcome ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  <CalendarCheck className="size-3.5" />
                  {CALL_OUTCOME_LABELS[call.outcome]}
                </span>
              ) : null}
              {call.sentiment && SENTIMENT_LABEL[call.sentiment] ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  <Smile className="size-3.5" />
                  {SENTIMENT_LABEL[call.sentiment]}
                </span>
              ) : null}
              {call.appointments[0]?.customerName || call.leads[0]?.name ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  <User className="size-3.5" />
                  {call.appointments[0]?.customerName ?? call.leads[0]?.name}
                </span>
              ) : null}
              {call.durationSec != null ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  <Clock className="size-3.5" />
                  {formatDuration(call.durationSec)}
                </span>
              ) : null}
              {entities.service ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/10 px-2 py-0.5 text-xs font-medium text-indigo-600 dark:text-indigo-400">
                  Wanted: {entities.service}
                </span>
              ) : null}
              {entities.requestedDate ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/10 px-2 py-0.5 text-xs font-medium text-indigo-600 dark:text-indigo-400">
                  When: {entities.requestedDate}
                </span>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
