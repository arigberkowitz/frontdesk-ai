"use client";

import { useEffect, useRef, useState } from "react";
import { useActionState } from "react";
import { Check, Loader2, Pause, Play, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { setVoiceByIdAction } from "@/lib/actions/guidelines";
import { initialActionState } from "@/lib/actions/types";
import { Button } from "@/components/ui/button";
import type { VoiceMeta } from "@/config/voice";
import { cn } from "@/lib/utils";

/**
 * Voice picker with a play button on every voice.
 *
 * Choosing a voice from a list of names is choosing blind — the whole
 * question is what it sounds like. Each row has the vendor's sample clip a
 * click away, one plays at a time, and picking a row saves immediately and
 * updates the live agent. Women and Men side by side, each list scrolling
 * on its own so the page doesn't grow with the vendor's catalogue.
 */
export function VoicePicker({
  clientId,
  current,
  women,
  men,
}: {
  clientId: string;
  current: string | null;
  women: VoiceMeta[];
  men: VoiceMeta[];
}) {
  const [state, action, pending] = useActionState(setVoiceByIdAction, initialActionState);
  const formRef = useRef<HTMLFormElement>(null);
  const voiceInputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState<string>(current ?? "");

  // One shared player. `playing` is the voiceId whose clip is sounding.
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  // Swapping `src` on a playing element fires a stray `pause` a tick later;
  // this flag lets the pause handler tell that apart from a real stop.
  const switching = useRef(false);

  useEffect(() => {
    if (state.ok) toast.success(state.message ?? "Voice updated — your receptionist now sounds different.");
    else if (state.error) toast.error(state.error);
  }, [state]);

  useEffect(() => () => audioRef.current?.pause(), []);

  function choose(v: VoiceMeta) {
    if (pending || v.voiceId === value) return;
    setValue(v.voiceId);
    if (voiceInputRef.current) voiceInputRef.current.value = v.voiceId;
    formRef.current?.requestSubmit();
  }

  function toggle(v: VoiceMeta) {
    const a = audioRef.current;
    if (!a || !v.previewUrl) return;
    if (playing === v.voiceId) {
      a.pause();
      setPlaying(null);
      setLoading(null);
      return;
    }
    switching.current = true;
    a.src = v.previewUrl;
    setLoading(v.voiceId);
    setPlaying(v.voiceId);
    a.play().catch(() => {
      switching.current = false;
      setLoading(null);
      setPlaying(null);
      toast.error("Couldn't play that sample just now.");
    });
  }

  const all = [...women, ...men];
  const selected = all.find((v) => v.voiceId === value) ?? null;

  // A plain render function, not a nested component: a component defined
  // inside render remounts every row on each state change and drops focus.
  function renderRow(v: VoiceMeta) {
    const isSel = v.voiceId === value;
    const isPlaying = playing === v.voiceId;
    const isLoading = loading === v.voiceId;
    return (
      <li key={v.voiceId}>
        <div
          className={cn(
            "flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm transition-colors",
            isSel ? "border-primary bg-primary/5" : "border-transparent hover:bg-muted/60",
          )}
        >
          <button
            type="button"
            onClick={() => choose(v)}
            disabled={pending}
            aria-pressed={isSel}
            className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          >
            <span
              className={cn(
                "flex size-4 shrink-0 items-center justify-center rounded-full border",
                isSel ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40",
              )}
              aria-hidden
            >
              {isSel ? <Check className="size-3" /> : null}
            </span>
            <span className="truncate font-medium">{v.name}</span>
            {v.accent ? (
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">{v.accent}</span>
            ) : null}
          </button>
          {v.previewUrl ? (
            <button
              type="button"
              onClick={() => toggle(v)}
              aria-label={isPlaying ? `Stop ${v.name}` : `Hear ${v.name}`}
              title={isPlaying ? "Stop" : "Hear a sample"}
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                isPlaying ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {isLoading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : isPlaying ? (
                <Pause className="size-3.5" />
              ) : (
                <Play className="size-3.5" />
              )}
            </button>
          ) : null}
        </div>
      </li>
    );
  }

  return (
    <form ref={formRef} action={action}>
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="voiceId" ref={voiceInputRef} defaultValue={current ?? ""} />
      <audio
        ref={audioRef}
        preload="none"
        className="hidden"
        onPlaying={() => {
          switching.current = false;
          setLoading(null);
        }}
        onPause={() => {
          if (switching.current) return;
          setPlaying(null);
          setLoading(null);
        }}
        onEnded={() => setPlaying(null)}
        onError={() => {
          setPlaying(null);
          setLoading(null);
        }}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <Volume2 className="size-4 text-muted-foreground" />
        <span className="text-muted-foreground">Speaking as</span>
        <span className="font-medium">{selected?.name ?? (value ? "a custom voice" : "no voice yet")}</span>
        {selected?.previewUrl ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => toggle(selected)}
            className="ml-1"
          >
            {playing === selected.voiceId ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            {playing === selected.voiceId ? "Stop" : "Hear it"}
          </Button>
        ) : null}
        {pending ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {[
          { title: "Women", list: women },
          { title: "Men", list: men },
        ].map(({ title, list }) =>
          list.length ? (
            <div key={title}>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {title}
              </p>
              <ul className="max-h-72 space-y-0.5 overflow-y-auto pr-1">
                {list.map(renderRow)}
              </ul>
            </div>
          ) : null,
        )}
      </div>
      {all.some((v) => v.previewUrl) ? null : (
        <p className="mt-2 text-xs text-muted-foreground">
          Samples appear here once your voice library is connected. Until then, use the test call
          above to hear the current voice.
        </p>
      )}
    </form>
  );
}
