"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { CalendarCheck, CalendarPlus } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form/field";
import { NativeSelect } from "@/components/form/native-select";
import { connectCalcomAction, disconnectCalendarAction } from "@/lib/actions/calendar";
import { initialActionState } from "@/lib/actions/types";

/**
 * "Connect your calendar" — provider picker, not a Google-only button.
 * Google = OAuth. Everything else (Outlook, Apple, other) bridges through a
 * free Cal.com account with numbered, linked steps so a non-technical owner
 * can follow along.
 */

function ExtLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-primary underline underline-offset-2"
    >
      {label}
    </a>
  );
}

function Steps({ intro, items }: { intro?: string; items: React.ReactNode[] }) {
  return (
    <div className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
      {intro ? <p className="mb-2">{intro}</p> : null}
      <ol className="space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2">
            <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
              {i + 1}
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
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
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <CalendarPlus className="size-4" />
          </div>
          <div className="text-sm">
            <p className="font-medium">Connect your calendar</p>
            <p className="text-muted-foreground">
              So your AI books real appointments. Until then it takes messages instead.
            </p>
          </div>
        </div>

        <NativeSelect
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          aria-label="Calendar type"
        >
          <option value="">Which calendar does your business use?</option>
          <option value="google">Google Calendar</option>
          <option value="outlook">Outlook / Microsoft 365</option>
          <option value="apple">Apple Calendar (iCloud)</option>
          <option value="calcom">Cal.com</option>
          <option value="other">Something else / not sure</option>
        </NativeSelect>

        {choice === "google" ? (
          <div className="space-y-2">
            <Steps
              items={[
                <>Click the button below.</>,
                <>Sign in with the Google account whose calendar you use.</>,
                <>
                  Approve the calendar permission — that&apos;s it. Bookings appear on your calendar
                  automatically.
                </>,
              ]}
            />
            <Button
              size="sm"
              nativeButton={false}
              render={
                <Link href={`/api/calendar/google/connect?client=${clientId}`} prefetch={false} />
              }
            >
              <CalendarPlus className="size-4" />
              Connect Google Calendar
            </Button>
            <p className="text-xs text-muted-foreground">
              Use a Google account you control — a personal Gmail or your own business&apos;s
              Google Workspace. School or employer accounts are often blocked by their IT
              policies (&quot;Access blocked: Authorization Error&quot;), and that&apos;s on their
              side, not yours.
            </p>
          </div>
        ) : null}

        {choice === "outlook" ? (
          <Steps
            intro="Outlook connects through a free Cal.com account — a 5-minute bridge, one time:"
            items={[
              <>
                Create a free account at <ExtLink href="https://app.cal.com/signup" label="cal.com/signup" />
                .
              </>,
              <>
                In Cal.com, open <strong>Settings → Calendars → Add</strong>, choose{" "}
                <strong>Outlook / Office 365</strong>, and sign in with your Microsoft account.
              </>,
              <>
                Open <ExtLink href="https://app.cal.com/settings/developer/api-keys" label="Settings → Developer → API keys" />
                , create a key, and copy it (starts with <code className="font-mono">cal_live_</code>).
              </>,
              <>Paste the key below and hit Connect. Bookings land on your Outlook calendar.</>,
            ]}
          />
        ) : null}

        {choice === "apple" ? (
          <Steps
            intro="Apple Calendar connects through a free Cal.com account — one-time, ~5 minutes:"
            items={[
              <>
                Create a free account at <ExtLink href="https://app.cal.com/signup" label="cal.com/signup" />
                .
              </>,
              <>
                Get an app-specific password at{" "}
                <ExtLink href="https://appleid.apple.com" label="appleid.apple.com" /> (Sign-In &
                Security → App-Specific Passwords).
              </>,
              <>
                In Cal.com, open <strong>Settings → Calendars → Add</strong>, choose{" "}
                <strong>Apple Calendar</strong>, and sign in with your Apple ID + that password.
              </>,
              <>
                Open <ExtLink href="https://app.cal.com/settings/developer/api-keys" label="Settings → Developer → API keys" />
                , create a key, copy it, paste it below, and hit Connect.
              </>,
            ]}
          />
        ) : null}

        {choice === "other" ? (
          <Steps
            intro="No problem — Cal.com is a free bridge that syncs with almost every calendar (and works on its own if you don't have one):"
            items={[
              <>
                Create a free account at <ExtLink href="https://app.cal.com/signup" label="cal.com/signup" />
                .
              </>,
              <>
                If you use another calendar app, link it under <strong>Settings → Calendars → Add</strong>{" "}
                (Outlook, Apple, Google, and more). No calendar at all? Skip this — Cal.com becomes
                your calendar.
              </>,
              <>
                Open <ExtLink href="https://app.cal.com/settings/developer/api-keys" label="Settings → Developer → API keys" />
                , create a key, copy it, paste it below, and hit Connect.
              </>,
            ]}
          />
        ) : null}

        {choice === "calcom" || choice === "other" || choice === "outlook" || choice === "apple" ? (
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
