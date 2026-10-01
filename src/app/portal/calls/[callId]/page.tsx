import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, AudioLines, Clock, Gauge, MessageSquareText, Moon, PhoneIncoming, PhoneOutgoing, Repeat, Sparkles, User } from "lucide-react";
import { getPortalEditAccess, resolvePortalClient } from "@/lib/auth-guard";
import { getCallForClient, getCallGrade } from "@/lib/data/calls";
import { getInsightForCall } from "@/lib/data/insights";
import { listSuggestionsForCall } from "@/lib/data/suggestions";
import { getCallerContext } from "@/lib/data/callers";
import { ordinal, otherParty } from "@/lib/callers";
import { analyzeCall } from "@/lib/call-health";
import { findMoments, turnsForCall } from "@/lib/call-moment";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CallAudioPlayer } from "@/components/portal/call-audio-player";
import { CallMoment } from "@/components/portal/call-moment";
import { CallTranscript } from "@/components/portal/call-transcript";
import { formatDateTime, formatDuration, formatPhone } from "@/lib/format";
import { CALL_OUTCOME_LABELS } from "@/config/options";
import { Chip, InitialsAvatar, OUTCOME_TONE, SENTIMENT_CHIP } from "@/components/portal/visual";

export default async function PortalCallPage({
  params,
}: {
  params: Promise<{ callId: string }>;
}) {
  const { callId } = await params;
  const { clientId } = await resolvePortalClient();
  const call = await getCallForClient(clientId, callId);
  if (!call) notFound();
  const party = otherParty(call);
  const [insight, grade, suggestions, access, caller] = await Promise.all([
    getInsightForCall(clientId, callId),
    getCallGrade(clientId, callId),
    listSuggestionsForCall(clientId, callId),
    getPortalEditAccess(clientId),
    getCallerContext(clientId, party, call.startAt),
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

      {/* Call header: who, when, how it went — the hero's glass, one call's worth. */}
      <section aria-labelledby="call-title" className="fd-panel fd-fade-up p-5 sm:p-6">
        <div aria-hidden className="fd-panel-glow" />
        <div className="flex items-start gap-4">
          <InitialsAvatar name={caller.name} seed={party ?? call.id} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="fd-eyebrow">
              {call.direction === "outbound" ? "Call your AI made" : "Call detail"}
            </p>
            <h1
              id="call-title"
              className="mt-1 truncate font-heading text-2xl leading-tight font-semibold tracking-tight sm:text-[1.75rem]"
            >
              {caller.name ?? (formatPhone(party) || "Unknown caller")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {caller.name && party ? `${formatPhone(party)} · ` : ""}
              {formatDateTime(call.startAt, call.client.timezone)}
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          {call.outcome ? (
            <Chip tone={OUTCOME_TONE[call.outcome] ?? "slate"} dot>
              {CALL_OUTCOME_LABELS[call.outcome]}
            </Chip>
          ) : null}
          {call.sentiment && SENTIMENT_CHIP[call.sentiment] ? (
            <Chip
              tone={SENTIMENT_CHIP[call.sentiment].tone}
              icon={SENTIMENT_CHIP[call.sentiment].icon}
              title="Caller sentiment"
            >
              {SENTIMENT_CHIP[call.sentiment].label} caller
            </Chip>
          ) : null}
          {grade ? (
            <Chip
              tone={grade.score >= 4 ? "emerald" : grade.score === 3 ? "amber" : "rose"}
              icon={Gauge}
              title="How well your AI handled this call (1–5)"
            >
              Score {grade.score}/5
            </Chip>
          ) : null}
          {call.isAfterHours ? (
            <Chip tone="violet" icon={Moon}>
              After hours
            </Chip>
          ) : null}
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
          <div className="fd-stat col-span-2 sm:col-span-1">
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {call.direction === "outbound" ? (
                <PhoneOutgoing className="size-3.5" aria-hidden />
              ) : (
                <PhoneIncoming className="size-3.5" aria-hidden />
              )}
              {call.direction === "outbound" ? "AI called" : "From"}
            </dt>
            <dd className="mt-1 truncate text-sm font-medium tabular-nums">
              {formatPhone(party) || "Unknown"}
            </dd>
          </div>
          <div className="fd-stat">
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="size-3.5" aria-hidden />
              Length
            </dt>
            <dd className="mt-1 font-heading text-lg leading-tight font-semibold tabular-nums">
              {formatDuration(call.durationSec)}
            </dd>
          </div>
          <div className="fd-stat">
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Moon className="size-3.5" aria-hidden />
              After hours
            </dt>
            <dd className="mt-1 text-sm font-medium">{call.isAfterHours ? "Yes" : "No"}</dd>
          </div>
        </dl>
        {caller.priorCalls > 0 ? (
          <Link
            href={`/portal/calls?from=${encodeURIComponent(party ?? "")}`}
            className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand underline-offset-2 hover:underline"
          >
            <Repeat className="size-3" aria-hidden />
            {ordinal(caller.priorCalls + 1)} call from this number
          </Link>
        ) : null}
      </section>

      {call.summary ? (
        <Card className="fd-hero-tile">
          <CardContent className="p-5">
            <div className="mb-2.5 flex items-center gap-2">
              <span className="fd-ai-dot" aria-hidden>
                <Sparkles className="size-3.5" />
              </span>
              <span className="text-sm font-medium">AI summary</span>
            </div>
            <p className="text-[15px] leading-relaxed">{call.summary}</p>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {call.appointments[0]?.customerName || call.leads[0]?.name ? (
                <Chip icon={User}>{call.appointments[0]?.customerName ?? call.leads[0]?.name}</Chip>
              ) : null}
              {call.durationSec != null ? (
                <Chip icon={Clock}>{formatDuration(call.durationSec)}</Chip>
              ) : null}
              {entities.service ? <Chip tone="violet">Wanted: {entities.service}</Chip> : null}
              {entities.requestedDate ? <Chip tone="cyan">When: {entities.requestedDate}</Chip> : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

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
            <CardTitle className="flex items-center gap-2">
              <AudioLines className="size-4 text-brand" aria-hidden />
              Listen to the call
            </CardTitle>
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
          <CardTitle className="flex items-center gap-2">
            <MessageSquareText className="size-4 text-brand" aria-hidden />
            Transcript
          </CardTitle>
        </CardHeader>
        <CardContent>
          <CallTranscript
            turns={turns}
            flagged={moments.map((m) => m.turnIndex)}
            hasRecording={Boolean(call.recordingUrl)}
            callerName={caller.name}
            callerSeed={party ?? call.id}
          />
        </CardContent>
      </Card>

    </div>
  );
}
