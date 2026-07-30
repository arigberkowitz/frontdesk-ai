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
/**
 * Disconnecting stops the AI booking anything — it drops back to taking
 * messages — so it asks once before doing it rather than firing on a stray
 * click. Same arm-then-confirm shape as cancelling an appointment.
 */
function DisconnectButton({ clientId }: { clientId: string }) {
  const [armed, setArmed] = useState(false);

  if (!armed) {
    return (
      <Button variant="outline" size="sm" onClick={() => setArmed(true)}>
        Disconnect
      </Button>
    );
  }
  return (
    <form action={disconnectCalendarAction} className="flex items-center gap-2">
      <input type="hidden" name="clientId" value={clientId} />
      <span className="text-xs text-muted-foreground">
        Your AI will stop booking and take messages instead.
      </span>
      <Button type="submit" variant="destructive" size="sm">
        Yes, disconnect
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setArmed(false)}>
        Keep it
      </Button>
    </form>
  );
}

export function CalendarConnect({
  clientId,
  provider,
  account,
  microsoftReady = false,
}: {
  clientId: string;
  provider: string | null;
  account: string | null;
  /** Azure OAuth app configured → Outlook connects with one click. */
  microsoftReady?: boolean;
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

  const connected = provider === "google" || provider === "calcom" || provider === "microsoft";

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
                {provider === "google"
                  ? "Google Calendar"
                  : provider === "microsoft"
                    ? "Outlook / Microsoft 365"
                    : "Cal.com"}{" "}
                connected
              </p>
              <p className="text-muted-foreground">
                {account ? `New bookings sync to ${account}` : "New bookings sync to your calendar"}
              </p>
            </div>
          </div>
          {/* One disconnect path for every provider: a POSTed server action.
              The old Google/Outlook variant was a plain GET link, which meant
              any page could trigger it with an <img> tag, and it skipped the
              agent republish — so the AI kept offering to book appointments
              onto a calendar it could no longer reach. */}
          <DisconnectButton clientId={clientId} />
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

        {/* One-click tiles: Google and Outlook jump STRAIGHT into OAuth — no
            dropdown, no intermediate step. Everything else expands short
            guided steps below. */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Button
            variant="outline"
            className={`h-auto flex-col gap-1 py-3 ${choice === "google" ? "border-primary" : ""}`}
            onClick={() => setChoice(choice === "google" ? "" : "google")}
          >
            <span className="text-base font-semibold">G</span>
            <span className="text-xs font-normal">Google Calendar</span>
          </Button>
          {microsoftReady ? (
            <Button
              variant="outline"
              className="h-auto flex-col gap-1 py-3"
              nativeButton={false}
              render={
                <Link href={`/api/calendar/microsoft/connect?client=${clientId}`} prefetch={false} />
              }
            >
              <span className="text-base font-semibold">O</span>
              <span className="text-xs font-normal">Outlook / 365</span>
            </Button>
          ) : (
            <Button
              variant="outline"
              className={`h-auto flex-col gap-1 py-3 ${choice === "outlook" ? "border-primary" : ""}`}
              onClick={() => setChoice(choice === "outlook" ? "" : "outlook")}
            >
              <span className="text-base font-semibold">O</span>
              <span className="text-xs font-normal">Outlook / 365</span>
            </Button>
          )}
          <Button
            variant="outline"
            className={`h-auto flex-col gap-1 py-3 ${choice === "apple" ? "border-primary" : ""}`}
            onClick={() => setChoice(choice === "apple" ? "" : "apple")}
          >
            <span className="text-base font-semibold">A</span>
            <span className="text-xs font-normal">Apple Calendar</span>
          </Button>
          <Button
            variant="outline"
            className={`h-auto flex-col gap-1 py-3 ${choice === "calcom" ? "border-primary" : ""}`}
            onClick={() => setChoice(choice === "calcom" ? "" : "calcom")}
          >
            <span className="text-base font-semibold">C</span>
            <span className="text-xs font-normal">Cal.com</span>
          </Button>
          <Button
            variant="outline"
            className={`h-auto flex-col gap-1 py-3 ${choice === "other" ? "border-primary" : ""}`}
            onClick={() => setChoice(choice === "other" ? "" : "other")}
          >
            <span className="text-base font-semibold">?</span>
            <span className="text-xs font-normal">Other / not sure</span>
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Use an account you control. School or employer accounts are often blocked by their own IT
          policies (&quot;Access blocked&quot;) — that&apos;s on their side, not yours.
        </p>

        {/* Google's review of our app is still in progress, so its consent flow
            shows a scary-looking "unverified app" interstitial. Telling people
            EXACTLY what they'll see and which link to click turns the single
            biggest drop-off point in setup into a non-event. */}
        {choice === "google" ? (
          <div className="space-y-2">
            <Steps
              intro="Two screens, about 20 seconds:"
              items={[
                <>Sign in with the Google account whose calendar you use.</>,
                <>
                  You&apos;ll likely see <strong>&ldquo;Google hasn&apos;t verified this
                  app&rdquo;</strong> — that&apos;s expected while our security review is in
                  progress, and it doesn&apos;t mean anything is wrong. Click{" "}
                  <strong>Advanced</strong>, then{" "}
                  <strong>&ldquo;Go to FrontDesk AI (unsafe)&rdquo;</strong>.
                </>,
                <>
                  Approve the calendar permission. Done — bookings land on your calendar
                  automatically.
                </>,
              ]}
            />
            <p className="text-xs text-muted-foreground">
              We only ask for calendar access — enough to check your free times and add bookings.
              We never read your email, contacts, or files. See our{" "}
              <ExtLink href="/privacy" label="Privacy Policy" />.
            </p>
            <Button
              nativeButton={false}
              render={
                <Link href={`/api/calendar/google/connect?client=${clientId}`} prefetch={false} />
              }
            >
              <CalendarPlus className="size-4" />
              Continue to Google
            </Button>
          </div>
        ) : null}

        {choice === "outlook" && !microsoftReady ? (
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
              <>
                Paste the key below and hit Connect — we verify it and pick your default event type
                automatically. Bookings land on your Outlook calendar.
              </>,
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

        {choice === "calcom" ||
        choice === "other" ||
        (choice === "outlook" && !microsoftReady) ||
        choice === "apple" ? (
          <form action={calcomAction} className="space-y-3">
            <input type="hidden" name="clientId" value={clientId} />
            <Field
              label="Cal.com API key"
              hint="We check it with Cal.com and pick your default event type for you."
              error={calcom.fieldErrors?.apiKey}
            >
              <Input name="apiKey" type="password" placeholder="cal_live_…" autoComplete="off" />
            </Field>
            <Button type="submit" size="sm" disabled={calcomPending}>
              {calcomPending ? "Verifying with Cal.com…" : "Connect Cal.com"}
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
