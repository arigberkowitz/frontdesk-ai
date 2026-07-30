"use client";

import { startTransition, useActionState, useState } from "react";
import { CalendarOff, Plus, Trash2, Utensils } from "lucide-react";
import { toast } from "sonner";
import {
  addAvailabilityBlockAction,
  deleteAvailabilityBlockAction,
} from "@/lib/actions/availability-blocks";
import { initialActionState, type ActionState } from "@/lib/actions/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form/field";
import { NativeSelect } from "@/components/form/native-select";
import { DAYS } from "@/config/options";

export interface TimeOffBlock {
  id: string;
  label: string;
  providerName: string | null;
  dayOfWeek: number | null;
  startTime: string | null;
  endTime: string | null;
  /** Pre-formatted in the client's timezone on the server. */
  windowLabel: string | null;
}

/** "Lunch · Every day, 12:00–13:00" / "Thanksgiving · Nov 27, 9:00 AM – Nov 28, 5:00 PM" */
function describe(b: TimeOffBlock): string {
  if (b.windowLabel) return b.windowLabel;
  const when = b.dayOfWeek == null ? "Every day" : `${DAYS[b.dayOfWeek]?.label ?? "?"}s`;
  return `${when}, ${b.startTime}–${b.endTime}`;
}

export function TimeOffCard({
  clientId,
  blocks,
  providers,
  canEdit,
}: {
  clientId: string;
  blocks: TimeOffBlock[];
  providers: Array<{ id: string; name: string }>;
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"recurring" | "one_off">("recurring");

  const [addState, addAction, adding] = useActionState(
    async (prev: ActionState, fd: FormData) => {
      const next = await addAvailabilityBlockAction(prev, fd);
      if (next.ok) {
        toast.success(next.message ?? "Added.");
        setOpen(false);
      } else if (next.error) toast.error(next.error);
      return next;
    },
    initialActionState,
  );

  const [, removeAction, removing] = useActionState(async (prev: ActionState, fd: FormData) => {
    const next = await deleteAvailabilityBlockAction(prev, fd);
    if (next.ok) toast.success(next.message ?? "Removed.");
    else if (next.error) toast.error(next.error);
    return next;
  }, initialActionState);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarOff className="size-4" /> Breaks &amp; time off
        </CardTitle>
        <CardDescription>
          Times you&apos;re open on paper but can&apos;t take an appointment — lunch, a holiday, a
          closure, someone on leave. Your AI treats these as unbookable and won&apos;t offer them.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {blocks.length > 0 ? (
          <ul className="divide-y rounded-lg border">
            {blocks.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 p-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    {b.windowLabel ? (
                      <CalendarOff className="size-4" />
                    ) : (
                      <Utensils className="size-4" />
                    )}
                  </span>
                  <div className="min-w-0 text-sm">
                    <p className="truncate font-medium">{b.label}</p>
                    <p className="truncate text-muted-foreground">
                      {describe(b)}
                      {b.providerName ? ` · ${b.providerName} only` : ""}
                    </p>
                  </div>
                </div>
                {canEdit ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={removing}
                    aria-label={`Remove ${b.label}`}
                    onClick={() => {
                      const fd = new FormData();
                      fd.set("clientId", clientId);
                      fd.set("blockId", b.id);
                      startTransition(() => removeAction(fd));
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nothing set. Your AI can book any open hour.
          </p>
        )}

        {canEdit && !open ? (
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            <Plus className="size-4" /> Add a break or closure
          </Button>
        ) : null}

        {canEdit && open ? (
          <form
            className="space-y-3 rounded-lg border bg-muted/30 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              fd.set("clientId", clientId);
              fd.set("kind", kind);
              startTransition(() => addAction(fd));
            }}
          >
            <Field label="What is it?" error={addState.fieldErrors?.label}>
              <Input name="label" placeholder="Lunch" required maxLength={80} />
            </Field>

            <Field label="How often?">
              <NativeSelect
                value={kind}
                onChange={(e) => setKind(e.target.value as "recurring" | "one_off")}
                className="h-9"
              >
                <option value="recurring">Every week (lunch, a regular break)</option>
                <option value="one_off">Specific dates (holiday, closure, leave)</option>
              </NativeSelect>
            </Field>

            {kind === "recurring" ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Day">
                  <NativeSelect name="dayOfWeek" defaultValue="" className="h-9">
                    <option value="">Every day</option>
                    {DAYS.map((d) => (
                      <option key={d.value} value={d.value}>
                        {d.label}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label="From" error={addState.fieldErrors?.startTime}>
                  <Input name="startTime" type="time" defaultValue="12:00" required />
                </Field>
                <Field label="To" error={addState.fieldErrors?.endTime}>
                  <Input name="endTime" type="time" defaultValue="13:00" required />
                </Field>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="First day closed" error={addState.fieldErrors?.startDate}>
                  <Input name="startDate" type="date" required />
                </Field>
                <Field label="Last day closed" error={addState.fieldErrors?.endDate}>
                  <Input name="endDate" type="date" required />
                </Field>
                <Field label="From (optional)" hint="Leave blank for the whole day">
                  <Input name="startTimeOneOff" type="time" />
                </Field>
                <Field label="To (optional)">
                  <Input name="endTimeOneOff" type="time" />
                </Field>
              </div>
            )}

            {providers.length > 0 ? (
              <Field label="Who does this affect?">
                <NativeSelect name="providerId" defaultValue="" className="h-9">
                  <option value="">The whole business</option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      Just {p.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            ) : null}

            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={adding}>
                {adding ? "Saving…" : "Save"}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
