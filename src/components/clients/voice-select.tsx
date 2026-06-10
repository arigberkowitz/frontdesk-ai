"use client";

import { useMemo, useState } from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { RECOMMENDED_VOICES, type VoiceMeta } from "@/config/voice";

// Sentinels — kept out of the real value space so they can't collide with a voiceId.
const DEFAULT = "__default__";
const CUSTOM = "__custom__";

function prettyProvider(p: string): string {
  const key = p.toLowerCase();
  if (key.includes("eleven") || key.includes("11labs")) return "ElevenLabs";
  if (key.includes("openai")) return "OpenAI";
  if (key.includes("play")) return "PlayHT";
  return p.charAt(0).toUpperCase() + p.slice(1);
}

/** Short "female, American · ElevenLabs"-style descriptor for a voice row. */
function describe(v: VoiceMeta): string {
  const traits = [v.gender, v.accent].filter(Boolean).join(", ");
  const provider = v.provider ? prettyProvider(v.provider) : "";
  return [traits, provider].filter(Boolean).join(" · ") || v.voiceId;
}

/**
 * Operator voice picker. Merges the live Retell voice list (authoritative, when
 * a key is set) with a curated fallback, and keeps a "Custom voice ID" escape
 * hatch so any Retell voice id is still reachable. Submits the chosen id as a
 * `voiceId` field inside the surrounding agent-config form.
 */
export function VoiceSelect({
  defaultValue,
  liveVoices,
}: {
  defaultValue: string | null;
  liveVoices?: VoiceMeta[];
}) {
  // Live voices first (accurate), then curated fallback; de-dupe by id.
  const options = useMemo<VoiceMeta[]>(() => {
    const seen = new Set<string>();
    const merged: VoiceMeta[] = [];
    for (const v of [...(liveVoices ?? []), ...RECOMMENDED_VOICES]) {
      if (!v.voiceId || seen.has(v.voiceId)) continue;
      seen.add(v.voiceId);
      merged.push(v);
    }
    return merged;
  }, [liveVoices]);

  const initial = (defaultValue ?? "").trim();
  const isKnown = initial !== "" && options.some((o) => o.voiceId === initial);

  const [selection, setSelection] = useState<string>(
    initial === "" ? DEFAULT : isKnown ? initial : CUSTOM,
  );
  const [custom, setCustom] = useState<string>(isKnown ? "" : initial);

  const resolved = selection === DEFAULT ? "" : selection === CUSTOM ? custom.trim() : selection;

  // Label map drives what the trigger shows for the selected value.
  const labels = useMemo<Record<string, string>>(() => {
    const m: Record<string, string> = {
      [DEFAULT]: "Use default voice",
      [CUSTOM]: custom.trim() ? `Custom — ${custom.trim()}` : "Custom voice ID…",
    };
    for (const o of options) m[o.voiceId] = o.name;
    return m;
  }, [options, custom]);

  const isLive = Boolean(liveVoices && liveVoices.length);

  return (
    <div className="space-y-2">
      {/* The value the agent-config form actually submits. */}
      <input type="hidden" name="voiceId" value={resolved} />
      <Select
        value={selection}
        onValueChange={(v) => setSelection((v as string | null) ?? DEFAULT)}
        items={labels}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          <SelectItem value={DEFAULT}>Use default voice</SelectItem>
          {options.length > 0 ? (
            <SelectGroup>
              <SelectLabel>{isLive ? "Retell voices" : "Recommended"}</SelectLabel>
              {options.map((o) => (
                <SelectItem key={o.voiceId} value={o.voiceId}>
                  <span className="flex w-full items-center justify-between gap-3">
                    <span>{o.name}</span>
                    <span className="text-xs text-muted-foreground">{describe(o)}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          ) : null}
          <SelectItem value={CUSTOM}>Custom voice ID…</SelectItem>
        </SelectContent>
      </Select>
      {selection === CUSTOM ? (
        <Input
          aria-label="Custom Retell voice ID"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="11labs-Adrian"
        />
      ) : null}
      {!isLive ? (
        <p className="text-xs text-muted-foreground">
          Connect Retell to browse the full voice library. Until then, pick a recommended voice or
          enter any Retell voice ID.
        </p>
      ) : null}
    </div>
  );
}
