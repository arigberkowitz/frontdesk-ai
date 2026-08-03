"use client";

import { useRef, useState } from "react";
import { Pause, Play } from "lucide-react";

function fmt(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

const SPEEDS = [1, 1.25, 1.5, 2] as const;

/** Styled audio player for a call recording — play/pause, seekable progress bar,
 *  and a playback-speed cycler (1× → 1.25× → 1.5× → 2×) for skimming calls. */
export function CallAudioPlayer({ src }: { src: string }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [speedIdx, setSpeedIdx] = useState(0);

  function toggle() {
    const a = ref.current;
    if (!a) return;
    if (a.paused) void a.play();
    else a.pause();
  }
  function cycleSpeed() {
    const next = (speedIdx + 1) % SPEEDS.length;
    setSpeedIdx(next);
    if (ref.current) ref.current.playbackRate = SPEEDS[next];
  }
  function seek(e: React.MouseEvent<HTMLDivElement>) {
    const a = ref.current;
    if (!a || !dur) return;
    // Keyboard "clicks" (Enter/Space) arrive with detail 0 and clientX 0, which
    // this read as "seek to the very beginning" — so tabbing to the bar and
    // pressing Enter threw away your place in the recording.
    if (e.detail === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    a.currentTime = ((e.clientX - rect.left) / rect.width) * dur;
  }

  function nudge(seconds: number) {
    const a = ref.current;
    if (!a || !dur) return;
    a.currentTime = Math.min(dur, Math.max(0, a.currentTime + seconds));
  }

  function onSeekKey(e: React.KeyboardEvent<HTMLDivElement>) {
    const a = ref.current;
    if (!a) return;
    const step = e.shiftKey ? 30 : 5;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowUp":
        nudge(step);
        break;
      case "ArrowLeft":
      case "ArrowDown":
        nudge(-step);
        break;
      case "Home":
        a.currentTime = 0;
        break;
      case "End":
        if (dur) a.currentTime = dur;
        break;
      case " ":
      case "Enter":
        toggle();
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  const pct = dur > 0 ? (cur / dur) * 100 : 0;

  return (
    <div className="flex items-center gap-3">
      <audio
        ref={ref}
        src={src}
        preload="metadata"
        className="hidden"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setCur(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          setDur(e.currentTarget.duration);
          e.currentTarget.playbackRate = SPEEDS[speedIdx];
        }}
      />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pause recording" : "Play recording"}
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white outline-none transition-colors hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {playing ? <Pause className="size-5" /> : <Play className="size-5" />}
      </button>
      <div className="min-w-0 flex-1">
        {/* A slider, not a button: arrow keys scrub, shift jumps 30s, Home and
            End go to the ends, and space still plays. */}
        <div
          role="slider"
          tabIndex={0}
          aria-label="Seek through the recording"
          aria-valuemin={0}
          aria-valuemax={Math.round(dur) || 0}
          aria-valuenow={Math.round(cur)}
          aria-valuetext={`${fmt(cur)} of ${fmt(dur)}`}
          onClick={seek}
          onKeyDown={onSeekKey}
          className="block h-1.5 w-full cursor-pointer rounded-full bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <span className="block h-full rounded-full bg-indigo-600" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-1.5 flex justify-between text-xs tabular-nums text-muted-foreground">
          <span>{fmt(cur)}</span>
          <span>{fmt(dur)}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={cycleSpeed}
        aria-label={`Playback speed ${SPEEDS[speedIdx]}x — click to change`}
        title="Playback speed"
        className="shrink-0 rounded-md border px-2 py-1 text-xs font-medium tabular-nums text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {SPEEDS[speedIdx]}×
      </button>
    </div>
  );
}
