"use client";

import { useActionState, useEffect, useState } from "react";
import { CalendarRange, Lock, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form/field";
import { saveBusyCalendarsAction } from "@/lib/actions/calendar";
import { initialActionState } from "@/lib/actions/types";

/**
 * Settings → Calendar → "Calendars that count as busy".
 *
 * Outlook: tick calendars from the mailbox's own list. Google: type a
 * calendar's ID — we can't list Google calendars without asking owners for a
 * new permission (and restarting Google's review), so we check each typed ID
 * with the free/busy permission we already have.
 */

export type BusyCalendarsData =
  | {
      kind: "microsoft";
      calendars: Array<{ id: string; name: string; isDefault: boolean; owner: string | null }>;
    }
  | { kind: "google_manual" }
  | { kind: "error"; message: string };

function Header({ account }: { account: string | null }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <CalendarRange className="size-4" />
      </div>
      <div className="text-sm">
        <p className="font-medium">Calendars that count as busy</p>
        <p className="text-muted-foreground">
          Your AI never books over events on these. Bookings still go to{" "}
          {account ? <span className="font-medium text-foreground">{account}</span> : "your main calendar"}.
        </p>
      </div>
    </div>
  );
}

export function BusyCalendarsCard({
  clientId,
  account,
  data,
  selected,
  canEdit,
}: {
  clientId: string;
  account: string | null;
  data: BusyCalendarsData;
  selected: string[];
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState(saveBusyCalendarsAction, initialActionState);
  const [googleIds, setGoogleIds] = useState<string[]>(selected);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (state.ok) toast.success(state.message ?? "Saved.");
    else if (state.error) toast.error(state.error);
  }, [state]);

  // When the saved list changes on the server (after a save), take it as the
  // new starting point and clear the "add" box. Adjusted during render — the
  // React-recommended way to reset state from props without an effect.
  const selectedKey = selected.join("\n");
  const [seenKey, setSeenKey] = useState(selectedKey);
  if (seenKey !== selectedKey) {
    setSeenKey(selectedKey);
    setGoogleIds(selected);
    setDraft("");
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <Header account={account} />

        {data.kind === "error" ? (
          <p className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-800">{data.message}</p>
        ) : null}

        {data.kind === "microsoft" ? (
          <form action={action} className="space-y-3">
            <input type="hidden" name="clientId" value={clientId} />
            <ul className="divide-y rounded-lg border">
              {data.calendars.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                  {c.isDefault ? (
                    <input type="checkbox" checked disabled aria-label={`${c.name} (always busy)`} className="size-4 accent-primary" />
                  ) : (
                    <input
                      type="checkbox"
                      name="calendarId"
                      value={c.id}
                      defaultChecked={selected.includes(c.id)}
                      disabled={!canEdit}
                      aria-label={c.name}
                      className="size-4 accent-primary"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{c.name}</p>
                    {c.owner ? <p className="truncate text-xs text-muted-foreground">{c.owner}</p> : null}
                  </div>
                  {c.isDefault ? (
                    <span className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                      Bookings go here
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
            <Button type="submit" size="sm" disabled={pending || !canEdit}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </form>
        ) : null}

        {data.kind === "google_manual" ? (
          <form action={action} className="space-y-3">
            <input type="hidden" name="clientId" value={clientId} />
            <ul className="divide-y rounded-lg border">
              <li className="flex items-center gap-3 px-3 py-2.5 text-sm">
                <Lock className="size-4 shrink-0 text-muted-foreground" />
                <p className="min-w-0 flex-1 truncate font-medium">Main calendar{account ? ` (${account})` : ""}</p>
                <span className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                  Bookings go here
                </span>
              </li>
              {googleIds.map((id) => (
                <li key={id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                  <input type="hidden" name="calendarId" value={id} />
                  <CalendarRange className="size-4 shrink-0 text-muted-foreground" />
                  <p className="min-w-0 flex-1 truncate font-mono text-xs">{id}</p>
                  {canEdit ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove ${id}`}
                      onClick={() => setGoogleIds(googleIds.filter((x) => x !== id))}
                    >
                      <X className="size-4" />
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
            {canEdit ? (
              <Field
                label="Add another calendar"
                hint='In Google Calendar: Settings → pick the calendar → "Integrate calendar" → Calendar ID. Calendars shared with you work too.'
                error={state.fieldErrors?.addCalendarId}
              >
                <Input
                  name="addCalendarId"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="family123@group.calendar.google.com"
                  autoComplete="off"
                />
              </Field>
            ) : null}
            <div className="flex items-center gap-2">
              <Button type="submit" size="sm" disabled={pending || !canEdit}>
                {pending ? "Checking with Google…" : draft.trim() ? (
                  <>
                    <Plus className="size-4" />
                    Add and save
                  </>
                ) : (
                  "Save"
                )}
              </Button>
            </div>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
