"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { setLeadStatusAction } from "@/lib/actions/leads";
import { initialActionState } from "@/lib/actions/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const OPTIONS = [
  { value: "new", label: "New", color: "#f59e0b" },
  { value: "contacted", label: "Contacted", color: "#3b82f6" },
  { value: "won", label: "Won", color: "#10b981" },
  { value: "lost", label: "Lost", color: "#9ca3af" },
] as const;

const LABELS: Record<string, string> = Object.fromEntries(OPTIONS.map((o) => [o.value, o.label]));
const COLORS: Record<string, string> = Object.fromEntries(OPTIONS.map((o) => [o.value, o.color]));

/** Inline follow-up status for a captured message; auto-saves on change. Uses the
 *  app's styled dropdown (not the native OS select) with a color-coded status dot. */
export function LeadStatusControl({
  leadId,
  clientId,
  status,
}: {
  leadId: string;
  clientId: string;
  status: string;
}) {
  const [state, action, pending] = useActionState(setLeadStatusAction, initialActionState);
  const formRef = useRef<HTMLFormElement>(null);
  const valueRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(status);

  useEffect(() => {
    if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <form ref={formRef} action={action} className="shrink-0">
      <input type="hidden" name="leadId" value={leadId} />
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="status" ref={valueRef} defaultValue={status} />
      <Select
        items={LABELS}
        value={value}
        disabled={pending}
        onValueChange={(v) => {
          const next = (v as string | null) ?? value;
          if (next === value) return;
          setValue(next);
          if (valueRef.current) valueRef.current.value = next;
          formRef.current?.requestSubmit();
        }}
      >
        <SelectTrigger className="h-8 w-32" aria-label="Follow-up status">
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ background: COLORS[value] ?? "#9ca3af" }}
            aria-hidden="true"
          />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              <span className="flex items-center gap-2">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: o.color }}
                  aria-hidden="true"
                />
                {o.label}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </form>
  );
}
