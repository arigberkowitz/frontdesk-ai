"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { CalendarCheck, CalendarPlus } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form/field";
import { connectCalcomAction, disconnectCalendarAction } from "@/lib/actions/calendar";
import { initialActionState } from "@/lib/actions/types";

/**
 * "Connect your calendar" — provider picker, not a Google-only button.
 * Google = OAuth. Cal.com = API key (and it doubles as the universal bridge:
 * Cal.com syncs with Outlook / Microsoft 365 / Apple on the business's side).
 */
export function CalendarConnect({
  clientId,
  provider,
  account,
}: {
  clientId: string;
  provider: string | null;
  account: string | null;
}) {
  const [choice, setChoice] = useState<string>("");
  const [calcom, calcomAction, calcomPending] = useActionState(
    connectCalcomAction,
    initialActionState,
  );

  useEffect(() => {
    if (calcom.ok) toast.success(calcom.message ?? "Calendar connected.");
    else if (calcom.error) toast.error(calcom.error);
  }, [calcom]);

  const connected = provider === "google" || provider === "calcom";

  if (connected) {
    return (
      <Card className="border-emerald-500/30 bg-emerald-500/5">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <CalendarCheck className="size-4" />
            </div>
            <div className="text-sm">
              <p className="font-medium">
                {provider === "google" ? "Google Calendar" : "Cal.com"} connected
              </p>
              <p className="text-muted-foreground">
                {account ? `New bookings sync to ${account}` : "New bookings sync to your calendar"}
              </p>
            </div>
          </div>
          {provider === "google" ? (
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={
                <Link href={`/api/calendar/google/disconnect?client=${clientId}`} prefetch={false} />
              }
            >
              Disconnect
            </Button>
          ) : (
            <form action={disconnectCalendarAction}>
              <input type="hidden" name="clientId" value={clientId} />
              <Button type="submit" variant="outline" size="sm">
                Disconnect
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
            <CalendarPlus className="size-4" />
          </div>
          <div className="text-sm">
            <p className="font-medium">Connect your calendar</p>
            <p className="text-muted-foreground">
              So your AI books real appointments. Until then it takes messages instead.
            </p>
          </div>
        </div>

        <select
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          aria-label="Calendar type"
          className="h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ring"
        >
          <option value="">Which calendar does your business use?</option>
          <option value="google">Google Calendar</option>
          <option value="calcom">Cal.com</option>
          <option value="other">Outlook / Microsoft 365 / Apple / other</option>
        </select>

        {choice === "google" ? (
          <Button
            size="sm"
            nativeButton={false}
            render={<Link href={`/api/calendar/google/connect?client=${clientId}`} prefetch={false} />}
          >
            <CalendarPlus className="size-4" />
            Connect Google Calendar
          </Button>
        ) : null}

        {choice === "other" ? (
          <p className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
            Easiest path: create a free Cal.com account, link your Outlook/Apple calendar to it
            (Cal.com → Settings → Calendars), then paste your Cal.com API key below. Bookings flow
            through to the calendar you already use.
          </p>
        ) : null}

        {choice === "calcom" || choice === "other" ? (
          <form action={calcomAction} className="space-y-3">
            <input type="hidden" name="clientId" value={clientId} />
            <Field label="Cal.com API key" error={calcom.fieldErrors?.apiKey}>
              <Input name="apiKey" type="password" placeholder="cal_live_…" autoComplete="off" />
            </Field>
            <Field
              label="Event type ID (optional)"
              hint="Cal.com → Event Types → the number in the URL. Leave blank to use your default."
              error={calcom.fieldErrors?.eventTypeId}
            >
              <Input name="eventTypeId" placeholder="123456" />
            </Field>
            <Button type="submit" size="sm" disabled={calcomPending}>
              {calcomPending ? "Connecting…" : "Connect Cal.com"}
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
