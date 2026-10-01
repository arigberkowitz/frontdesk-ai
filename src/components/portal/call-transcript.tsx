"use client";

import { seekRecording } from "@/components/portal/call-audio-player";
import { clock, type Turn } from "@/lib/call-moment";
import { cn } from "@/lib/utils";
import { Sparkles } from "lucide-react";
import { InitialsAvatar } from "@/components/portal/visual";

/**
 * The transcript as a conversation, not a wall of text: the AI on the left,
 * the caller on the right, a timestamp on each turn that scrubs the recording
 * to it, and the flagged turns lit up so the eye lands where the problem is.
 */
export function CallTranscript({
  turns,
  flagged,
  hasRecording,
  callerName,
  callerSeed,
}: {
  turns: Turn[];
  /** Shown as initials beside the caller's turns (display only). */
  callerName?: string | null;
  callerSeed?: string | null;
  /** Indices of turns the health check pointed at. */
  flagged: number[];
  hasRecording: boolean;
}) {
  if (!turns.length) {
    return <p className="text-sm text-muted-foreground">No transcript captured.</p>;
  }
  const hot = new Set(flagged);

  return (
    <ol className="space-y-3.5">
      {turns.map((t, i) => {
        const isAgent = t.role === "agent";
        const isHot = hot.has(i);
        const canSeek = hasRecording && t.startSec != null;
        return (
          <li
            key={i}
            id={`turn-${i}`}
            className={cn(
              "flex scroll-mt-24 items-end gap-2.5",
              isAgent ? "flex-row" : "flex-row-reverse",
            )}
          >
            {isAgent ? (
              <span className="fd-ai-dot mb-5" aria-hidden>
                <Sparkles className="size-3.5" />
              </span>
            ) : t.role === "user" ? (
              <InitialsAvatar name={callerName} seed={callerSeed} size="sm" className="mb-5" />
            ) : (
              <span className="size-7 shrink-0" aria-hidden />
            )}
            <div className={cn("flex min-w-0 flex-col", isAgent ? "items-start" : "items-end")}>
              <div
                className={cn(
                  "max-w-[min(34rem,100%)] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed transition-shadow",
                  isAgent
                    ? "fd-turn-agent rounded-bl-md text-foreground"
                    : t.role === "user"
                      ? "fd-turn-user rounded-br-md text-foreground"
                      : "bg-muted/60 text-muted-foreground",
                  isHot && "ring-2 ring-amber-500/70 ring-offset-2 ring-offset-background",
                )}
              >
                {t.text}
              </div>
              <div className="mt-1 flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
                <span className="font-medium">{t.speaker}</span>
                {t.startSec != null ? (
                  canSeek ? (
                    <button
                      type="button"
                      onClick={() => seekRecording(t.startSec!)}
                      className="rounded px-1 tabular-nums underline-offset-2 hover:bg-muted hover:underline"
                      title="Play the recording from here"
                    >
                      {clock(t.startSec)}
                    </button>
                  ) : (
                    <span className="tabular-nums">{clock(t.startSec)}</span>
                  )
                ) : null}
                {isHot ? (
                  <span className="rounded-full bg-amber-500/15 px-1.5 font-medium text-amber-800 dark:text-amber-300">
                    flagged
                  </span>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
