"use client";

import { seekRecording } from "@/components/portal/call-audio-player";
import { clock, type Turn } from "@/lib/call-moment";
import { cn } from "@/lib/utils";

/**
 * The transcript as a conversation, not a wall of text: the AI on the left,
 * the caller on the right, a timestamp on each turn that scrubs the recording
 * to it, and the flagged turns lit up so the eye lands where the problem is.
 */
export function CallTranscript({
  turns,
  flagged,
  hasRecording,
}: {
  turns: Turn[];
  /** Indices of turns the health check pointed at. */
  flagged: number[];
  hasRecording: boolean;
}) {
  if (!turns.length) {
    return <p className="text-sm text-muted-foreground">No transcript captured.</p>;
  }
  const hot = new Set(flagged);

  return (
    <ol className="space-y-3">
      {turns.map((t, i) => {
        const isAgent = t.role === "agent";
        const isHot = hot.has(i);
        const canSeek = hasRecording && t.startSec != null;
        return (
          <li
            key={i}
            id={`turn-${i}`}
            className={cn("flex scroll-mt-24 flex-col", isAgent ? "items-start" : "items-end")}
          >
            <div
              className={cn(
                "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed transition-shadow",
                isAgent
                  ? "rounded-tl-sm bg-indigo-500/10 text-foreground"
                  : t.role === "user"
                    ? "rounded-tr-sm bg-muted text-foreground"
                    : "bg-muted/60 text-muted-foreground",
                isHot && "ring-2 ring-amber-500/70 ring-offset-2 ring-offset-background",
              )}
            >
              {t.text}
            </div>
            <div className="mt-1 flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
              <span>{t.speaker}</span>
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
                <span className="rounded-full bg-amber-500/15 px-1.5 font-medium text-amber-700 dark:text-amber-300">
                  flagged
                </span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
