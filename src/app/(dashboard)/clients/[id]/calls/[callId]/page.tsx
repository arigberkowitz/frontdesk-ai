import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarCheck, Inbox, ShieldCheck } from "lucide-react";
import { requireOperator } from "@/lib/auth-guard";
import { getCall } from "@/lib/data/calls";
import { getGradeForCall } from "@/lib/data/grades";
import { getInsightForCall } from "@/lib/data/insights";
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
  const [grade, insight] = await Promise.all([
    getGradeForCall(id, callId),
    getInsightForCall(id, callId),
  ]);
  const gradeFlags = ((grade?.flags as string[] | null) ?? []).filter(
    (f) => f !== "compliance_risk",
  );
  const entities = (insight?.entities ?? {}) as Record<string, string>;
  const entityChips = [
    entities.service && `wants: ${entities.service}`,
    entities.requestedDate && `when: ${entities.requestedDate}`,
    entities.budget && `budget: ${entities.budget}`,
  ].filter(Boolean) as string[];

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

      {grade || insight ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-indigo-600 dark:text-indigo-400" />
              Agent analysis
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {grade ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${
                    grade.score <= 2
                      ? "bg-red-500/10 text-red-600 dark:text-red-400"
                      : grade.score === 3
                        ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                        : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  }`}
                >
                  QA {grade.score}/5
                </span>
                {grade.complianceRisk ? (
                  <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-600 dark:text-red-400">
                    compliance risk
                  </span>
                ) : null}
                {gradeFlags.map((f) => (
                  <span
                    key={f}
                    className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400"
                  >
                    {f.replaceAll("_", " ")}
                  </span>
                ))}
              </div>
            ) : null}
            {grade?.coachingNote ? (
              <p className="text-sm text-muted-foreground">{grade.coachingNote}</p>
            ) : null}
            {insight ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {insight.intent ? (
                  <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-xs font-medium text-indigo-600 dark:text-indigo-400">
                    {insight.intent.replaceAll("_", " ")}
                  </span>
                ) : null}
                {insight.isSpam ? (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    spam
                  </span>
                ) : null}
                {entityChips.map((c) => (
                  <span
                    key={c}
                    className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-xs font-medium text-indigo-600 dark:text-indigo-400"
                  >
                    {c}
                  </span>
                ))}
              </div>
            ) : null}
            {insight?.followUpDraft ? (
              <p className="rounded-lg bg-indigo-500/5 px-3 py-2 text-xs text-muted-foreground">
                <span className="font-medium text-indigo-600 dark:text-indigo-400">
                  Drafted follow-up:{" "}
                </span>
                &ldquo;{insight.followUpDraft}&rdquo;
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {call.appointments.length > 0 || call.leads.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {call.appointments.map((a) => (
            <Card key={a.id}>
              <CardContent className="flex items-center gap-3 p-4">
                <CalendarCheck className="size-5 text-emerald-600 dark:text-emerald-400" />
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
                <Inbox className="size-5 text-indigo-600 dark:text-indigo-400" />
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
