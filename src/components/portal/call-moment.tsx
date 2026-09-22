"use client";

import { useTransition } from "react";
import { AlertTriangle, Check, GraduationCap, Play, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { seekRecording } from "@/components/portal/call-audio-player";
import { approveSuggestionAction, dismissSuggestionAction } from "@/lib/actions/suggestions";
import { clock, type Moment, type Turn } from "@/lib/call-moment";
import { cn } from "@/lib/utils";
import type { AgentSuggestion } from "@/db/schema";

/** The QA supervisor's defect flags, in the owner's words. */
const FLAG_LABEL: Record<string, string> = {
  missed_booking: "Missed a booking",
  wrong_or_vague_answer: "Wrong or vague answer",
  fallback_used: "Fell back to a canned line",
  caller_frustrated: "Caller got frustrated",
  hours_or_price_error: "Got hours or a price wrong",
  transfer_failed: "Transfer didn't work",
  compliance_risk: "Said something risky",
};

export interface GradeSummary {
  score: number;
  flags: string[];
  coachingNote: string | null;
}

/**
 * The card that turns "this call was flagged" into "here — listen to this
 * line". Each moment quotes the turn, jumps the recording to it, and scrolls
 * the transcript to it. If the nightly loop already drafted a fix from this
 * call, it's approvable right here, so the owner goes from hearing the
 * problem to fixing it without leaving the page.
 */
export function CallMoment({
  clientId,
  moments,
  turns,
  notes,
  grade,
  suggestions,
  canEdit,
  hasRecording,
}: {
  clientId: string;
  moments: Moment[];
  turns: Turn[];
  /** Plain-English lines from the health check, one per problem. */
  notes: string[];
  grade: GradeSummary | null;
  suggestions: AgentSuggestion[];
  canEdit: boolean;
  hasRecording: boolean;
}) {
  const [pending, start] = useTransition();

  function act(action: (fd: FormData) => Promise<void>, suggestionId: string) {
    const fd = new FormData();
    fd.set("clientId", clientId);
    fd.set("suggestionId", suggestionId);
    start(() => action(fd));
  }

  function goTo(m: Moment) {
    const t = turns[m.turnIndex];
    document
      .getElementById(`turn-${m.turnIndex}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (hasRecording && t?.startSec != null) seekRecording(t.startSec);
  }

  const flags = grade?.flags.map((f) => FLAG_LABEL[f] ?? f.replace(/_/g, " ")) ?? [];

  return (
    <Card className="border-amber-500/40 bg-amber-500/5">
      <CardContent className="p-5">
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
          <span className="text-sm font-medium">What went wrong</span>
          {grade ? (
            <span
              className="ml-auto text-xs tabular-nums text-muted-foreground"
              title="The QA supervisor's score for this call, out of 5"
            >
              Scored {grade.score}/5
            </span>
          ) : null}
        </div>

        {flags.length || grade?.coachingNote ? (
          <div className="mt-3 space-y-1.5">
            {flags.length ? (
              <div className="flex flex-wrap gap-1.5">
                {flags.map((f) => (
                  <span
                    key={f}
                    className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300"
                  >
                    {f}
                  </span>
                ))}
              </div>
            ) : null}
            {grade?.coachingNote ? (
              <p className="text-sm leading-relaxed">{grade.coachingNote}</p>
            ) : null}
          </div>
        ) : null}

        {notes.length ? (
          <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        ) : null}

        {moments.length ? (
          <ol className="mt-4 space-y-3">
            {moments.map((m) => {
              const t = turns[m.turnIndex];
              return (
                <li key={m.turnIndex} className="rounded-lg border bg-background/70 p-3">
                  <p className="text-xs font-medium text-muted-foreground">{m.label}</p>
                  <blockquote
                    className={cn(
                      "mt-1.5 border-l-2 pl-3 text-sm leading-relaxed",
                      t.role === "agent" ? "border-indigo-500/50" : "border-amber-500/50",
                    )}
                  >
                    <span className="font-medium">{t.speaker}:</span> “{t.text}”
                  </blockquote>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => goTo(m)}>
                      <Play className="size-3.5" />
                      {hasRecording && t.startSec != null
                        ? `Listen from ${clock(t.startSec)}`
                        : "Show in transcript"}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : null}

        {suggestions.length ? (
          <div className="mt-4 border-t pt-4">
            <div className="flex items-center gap-2">
              <GraduationCap className="size-4 text-indigo-600 dark:text-indigo-400" />
              <span className="text-sm font-medium">
                Your AI drafted a fix from this call
              </span>
            </div>
            <ul className="mt-2 space-y-2">
              {suggestions.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-col gap-2 rounded-lg border bg-background/70 p-3 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0">
                    {s.type === "knowledge" ? (
                      <>
                        <p className="text-sm font-medium">{s.question}</p>
                        {s.answer ? (
                          <p className="mt-0.5 text-sm text-muted-foreground">{s.answer}</p>
                        ) : null}
                      </>
                    ) : (
                      <p className="text-sm font-medium">{s.guidance}</p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">{s.rationale}</p>
                  </div>
                  {canEdit ? (
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        size="sm"
                        disabled={pending}
                        onClick={() => act(approveSuggestionAction, s.id)}
                      >
                        <Check className="size-3.5" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        onClick={() => act(dismissSuggestionAction, s.id)}
                      >
                        <X className="size-3.5" />
                        Dismiss
                      </Button>
                    </div>
                  ) : (
                    <span className="shrink-0 text-xs text-muted-foreground">awaiting your admin</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
