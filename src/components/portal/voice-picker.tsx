"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useActionState } from "react";
import { toast } from "sonner";
import { setVoiceByIdAction } from "@/lib/actions/guidelines";
import { initialActionState } from "@/lib/actions/types";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { VoiceMeta } from "@/config/voice";

function accentOf(v: VoiceMeta): string {
  return v.accent ? v.accent : "";
}

/**
 * Voice selector for the client portal: one dropdown, categorized into
 * **Women** and **Men**, listing the real voices in each. Saves on selection
 * and updates the live agent immediately.
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

  useEffect(() => {
    if (state.ok) toast.success("Voice updated — your receptionist now sounds different.");
    else if (state.error) toast.error(state.error);
  }, [state]);

  // Trigger label resolution: map every offered voiceId to its display name.
  const labels = useMemo<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const v of [...women, ...men]) m[v.voiceId] = v.name;
    // Keep showing something sensible if the saved voice isn't in the list.
    if (current && !m[current]) m[current] = "Current voice";
    return m;
  }, [women, men, current]);

  return (
    <form ref={formRef} action={action} className="max-w-sm">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="voiceId" ref={voiceInputRef} defaultValue={current ?? ""} />
      <Select
        items={labels}
        value={value}
        disabled={pending}
        onValueChange={(v) => {
          const next = (v as string | null) ?? "";
          if (!next || next === value) return;
          setValue(next);
          // Set the submitted value synchronously, then submit — avoids a render race.
          if (voiceInputRef.current) voiceInputRef.current.value = next;
          formRef.current?.requestSubmit();
        }}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Choose a voice" />
        </SelectTrigger>
        <SelectContent className="max-h-80">
          {women.length > 0 ? (
            <SelectGroup>
              <SelectLabel>Women</SelectLabel>
              {women.map((v) => (
                <SelectItem key={v.voiceId} value={v.voiceId}>
                  <span className="flex w-full items-center justify-between gap-3">
                    <span>{v.name}</span>
                    {accentOf(v) ? (
                      <span className="text-xs text-muted-foreground">{accentOf(v)}</span>
                    ) : null}
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          ) : null}
          {men.length > 0 ? (
            <SelectGroup>
              <SelectLabel>Men</SelectLabel>
              {men.map((v) => (
                <SelectItem key={v.voiceId} value={v.voiceId}>
                  <span className="flex w-full items-center justify-between gap-3">
                    <span>{v.name}</span>
                    {accentOf(v) ? (
                      <span className="text-xs text-muted-foreground">{accentOf(v)}</span>
                    ) : null}
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          ) : null}
        </SelectContent>
      </Select>
    </form>
  );
}
