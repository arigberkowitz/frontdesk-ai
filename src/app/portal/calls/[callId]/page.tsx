import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarCheck, Clock, Smile, Sparkles, User } from "lucide-react";
import { getPortalEditAccess, resolvePortalClient } from "@/lib/auth-guard";
import { getCallForClient, getCallGrade } from "@/lib/data/calls";
import { getInsightForCall } from "@/lib/data/insights";
import { listSuggestionsForCall } from "@/lib/data/suggestions";
import { analyzeCall } from "@/lib/call-health";
import { findMoments, turnsForCall } from "@/lib/call-moment";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CallAudioPlayer } from "@/components/portal/call-audio-player";
import { CallMoment } from "@/components/portal/call-moment";
import { CallTranscript } from "@/components/portal/call-transcript";
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
  const [insight, grade, suggestions, access] = await Promise.all([
    getInsightForCall(clientId, callId),
    getCallGrade(clientId, callId),
    listSuggestionsForCall(clientId, callId),
    getPortalEditAccess(clientId),
  ]);
  const entities = (insight?.entities ?? {}) as Record<string, string>;

  // The same checks the Overview's call-health panel runs, applied to this
  // one call, then pinned to the exact turns they're about.
  const health = analyzeCall({
    transcript: call.transcript,
    durationSec: call.durationSec,
    outcome: call.outcome,
    hasContact: call.leads.length > 0 || call.appointments.length > 0,
    transferConnected: call.outcome === "escalated",
    expectsDisclosure: call.client.recordingDisclosureEnabled ?? false,
  });
  const turns = turnsForCall(call, call.client.agentName);
  const moments = findMoments(health.problems, turns);
  const gradeSummary =
    grade && (grade.score <= 3 || (Array.isArray(grade.flags) && grade.flags.length > 0))
      ? {
          score: grade.score,
          flags: Array.isArray(grade.flags) ? (grade.flags as string[]) : [],
          coachingNote: grade.coachingNote,
        }
      : null;
  const wentWrong = health.problems.length > 0 || gradeSummary !== null || suggestions.length > 0;

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

      {wentWrong ? (
        <CallMoment
          clientId={clientId}
          moments={moments}
          turns={turns}
          notes={health.notes}
          grade={gradeSummary}
          suggestions={suggestions}
          canEdit={access.canEdit}
          hasRecording={Boolean(call.recordingUrl)}
        />
      ) : null}

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
          <CallTranscript
            turns={turns}
            flagged={moments.map((m) => m.turnIndex)}
            hasRecording={Boolean(call.recordingUrl)}
          />
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
