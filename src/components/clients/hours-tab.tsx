"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { saveHoursAction } from "@/lib/actions/hours";
import { initialActionState } from "@/lib/actions/types";
import { DAYS } from "@/config/options";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/form/submit-button";
import { cn } from "@/lib/utils";
import type { BusinessHour } from "@/db/schema";

export function HoursTab({ clientId, hours }: { clientId: string; hours: BusinessHour[] }) {
  const [state, action, pending] = useActionState(saveHoursAction, initialActionState);
  useEffect(() => {
    if (state.ok) toast.success(state.message ?? "Hours saved");
    else if (state.error) toast.error(state.error);
  }, [state]);

  const byDay = new Map(hours.map((h) => [h.dayOfWeek, h]));
  const [closedDays, setClosedDays] = useState<Record<number, boolean>>(() =>
    Object.fromEntries(
      DAYS.map((d) => {
        const h = byDay.get(d.value);
        return [d.value, h ? h.isClosed : d.value === 0 || d.value === 6];
      }),
    ),
  );

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="clientId" value={clientId} />
      <p className="text-sm text-muted-foreground">
        Used to flag after-hours calls (the AI answers 24/7 regardless).
      </p>
      <div className="divide-y rounded-xl border">
        {DAYS.map((d) => {
          const h = byDay.get(d.value);
          const closed = closedDays[d.value];
          return (
            <div
              key={d.value}
              className="grid grid-cols-1 items-center gap-3 p-3 sm:grid-cols-[110px_1fr_auto]"
            >
              <span className="font-medium">{d.label}</span>
              <div
                className={cn(
                  "flex items-center gap-2 transition-opacity",
                  closed && "pointer-events-none opacity-40",
                )}
              >
                {/* The weekday name labels this row visually, but a screen
                    reader reaching these inputs hears only "time, blank" twice
                    over — seven days running. */}
                <Input
                  type="time"
                  name={`open_${d.value}`}
                  aria-label={`${d.label} opening time`}
                  defaultValue={h?.openTime ?? "09:00"}
                  disabled={closed}
                  className="w-36"
                />
                <span aria-hidden className="text-muted-foreground">
                  –
                </span>
                <Input
                  type="time"
                  name={`close_${d.value}`}
                  aria-label={`${d.label} closing time`}
                  defaultValue={h?.closeTime ?? "17:00"}
                  disabled={closed}
                  className="w-36"
                />
              </div>
              <div className="flex items-center gap-2 justify-self-start sm:justify-self-end">
                <Switch
                  id={`closed_${d.value}`}
                  name={`closed_${d.value}`}
                  checked={closed}
                  onCheckedChange={(v) => setClosedDays((s) => ({ ...s, [d.value]: v }))}
                />
                <Label htmlFor={`closed_${d.value}`} className="text-muted-foreground">
                  Closed
                </Label>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-end">
        <SubmitButton pending={pending}>Save hours</SubmitButton>
      </div>
    </form>
  );
}
