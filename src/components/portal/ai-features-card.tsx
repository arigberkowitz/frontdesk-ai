"use client";

import { startTransition, useActionState, useId, useOptimistic, useState } from "react";
import Link from "next/link";
import { Bot, CalendarClock, PhoneCall, PhoneMissed, Sparkles, Sun, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { PanelHeader } from "@/components/panel-header";
import { saveAiTextRepliesSettingsAction } from "@/lib/actions/sms-ai";
import { saveMissedCallSettingsAction } from "@/lib/actions/missed-call-settings";
import { saveSmartRebookingSettingsAction } from "@/lib/actions/rebooking";
import { savePortalProfileAction } from "@/lib/actions/portal";
import { initialActionState, type ActionState } from "@/lib/actions/types";
import { switchboardFields, type FeatureStatus } from "@/lib/ai-features";
import { cn } from "@/lib/utils";

type ServerAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export interface AiFeaturesCardProps {
  clientId: string;
  /** Owner/admin (or operator). Everyone else sees the status, read-only. */
  isAdmin: boolean;
  aiTextReplies: { enabled: boolean; pauseHours: number; status: FeatureStatus; bookingEnabled: boolean };
  missedCall: {
    enabled: boolean;
    status: FeatureStatus;
    /** The AI phone callback — only rendered when the platform env var allows it. */
    aiCallbacksAvailable: boolean;
    aiCallbacksEnabled: boolean;
  };
  smartRebooking: { enabled: boolean; status: FeatureStatus };
  dailyBriefing: { enabled: boolean; status: FeatureStatus; ownerEmail: string | null };
  /** Plain-language limits repeated from Settings → Follow-ups. */
  limits: { repliesPerThreadPerDay: number; callbackDedupeDays: number; callbacksPerDay: number; rebookOfferHours: number };
}

/**
 * Overview → "AI features": one on/off switch per optional AI job, with a
 * one-line description and what it did lately. It posts to the SAME server
 * actions (and so the same admin-only checks) as the cards in Settings →
 * Follow-ups / Alerts. Turning on anything that texts or calls customers asks
 * once, with the consent and texting-hours rules in front of the owner.
 */
export function AiFeaturesCard(p: AiFeaturesCardProps) {
  const { clientId, isAdmin, limits } = p;
  // The AI call-back sub-switch rides on the main text-back switch: it shows
  // only while texts are on, and starts from "off" after any change to the
  // main switch (the server clears it whenever texts are switched).
  const [missedOn, setMissedOn] = useState(p.missedCall.enabled);
  const [mainChanges, setMainChanges] = useState(0);

  return (
    <Card id="ai-features" className="scroll-mt-24">
      <CardContent className="p-5 sm:p-6">
        <PanelHeader
          icon={Sparkles}
          title="AI features"
          description="Extra jobs your AI can take on. Each one stays off until you turn it on."
          action={
            <Link
              href="/portal/settings/follow-ups"
              className="text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              More options
            </Link>
          }
        />
        <ul className="mt-4 divide-y divide-border/70">
          <FeatureRow
            icon={Bot}
            title="AI text replies"
            description="Answers customer texts from your services, hours and FAQ, and can book or move appointments."
            status={p.aiTextReplies.status}
            initialOn={p.aiTextReplies.enabled}
            isAdmin={isAdmin}
            action={saveAiTextRepliesSettingsAction}
            form={(on) => toForm(switchboardFields("aiTextReplies", clientId, on, { pauseHours: p.aiTextReplies.pauseHours }))}
            confirmNotes={[
              "Only replies to people who texted you first, and never to anyone who texted STOP.",
              `Replies only between 9am and 8pm your time, at most ${limits.repliesPerThreadPerDay} AI texts per conversation a day.`,
              "Hands the conversation to you when someone asks for a person, it sounds urgent, or it isn't sure.",
              ...(p.aiTextReplies.bookingEnabled
                ? []
                : ["No calendar is connected, so it answers questions but passes booking requests to you."]),
            ]}
          />
          <FeatureRow
            icon={PhoneMissed}
            title="Missed-call text-back"
            description="Texts callers who hung up, got cut off or left mid-booking, offering to finish by text."
            status={p.missedCall.status}
            initialOn={p.missedCall.enabled}
            isAdmin={isAdmin}
            action={saveMissedCallSettingsAction}
            // Flipping the main switch never turns the AI phone callback on;
            // that's its own, separate yes below.
            form={(on) => toForm(switchboardFields("missedCallTexts", clientId, on))}
            onSaved={(on) => {
              setMissedOn(on);
              setMainChanges((n) => n + 1);
            }}
            confirmNotes={[
              "Only to callers who've agreed to texts from you, and never after STOP.",
              `One text per caller every ${limits.callbackDedupeDays} days, at most ${limits.callbacksPerDay} a day.`,
              "Sent 9am–8pm their time; a late-night call gets its text the next morning.",
            ]}
          >
            {p.missedCall.aiCallbacksAvailable && missedOn ? (
              <FeatureRow
                key={mainChanges}
                nested
                icon={PhoneCall}
                title="AI calls them back instead"
                description="Your AI phones them from your number and says it's an AI. If it can't, they get the text."
                status={null}
                initialOn={mainChanges === 0 ? p.missedCall.aiCallbacksEnabled : false}
                isAdmin={isAdmin}
                action={saveMissedCallSettingsAction}
                form={(on) => toForm(switchboardFields("aiCallbacks", clientId, on))}
                confirmNotes={[
                  "Same rules as the texts: only callers who agreed to hear from you, 9am–8pm their time, never after STOP.",
                  "The AI says it's an AI at the start of the call.",
                ]}
              />
            ) : null}
          </FeatureRow>
          <FeatureRow
            icon={CalendarClock}
            title="Smart rebooking"
            description="When you block time over bookings, text those customers 2–3 new times to pick from."
            status={p.smartRebooking.status}
            initialOn={p.smartRebooking.enabled}
            isAdmin={isAdmin}
            action={saveSmartRebookingSettingsAction}
            form={(on) => toForm(switchboardFields("smartRebooking", clientId, on))}
            confirmNotes={[
              "Nothing is sent until you press “Ask customers to rebook” on Hours and confirm.",
              "Only to customers who agreed to texts about their booking, never after STOP, 9am–8pm.",
              `Offers stay open ${limits.rebookOfferHours} hours; anything other than 1, 2, 3 or NO comes to you.`,
            ]}
          />
          <FeatureRow
            icon={Sun}
            title="Morning briefing"
            description={
              p.dailyBriefing.ownerEmail
                ? `A short email each morning (7–10am your time) with yesterday's calls and today's schedule, to ${p.dailyBriefing.ownerEmail}.`
                : "A short email each morning (7–10am your time) with yesterday's calls and today's schedule."
            }
            status={p.dailyBriefing.status}
            statusLink={
              p.dailyBriefing.status.tone === "warn"
                ? { href: "/portal/settings/alerts", label: "Add an alerts email" }
                : undefined
            }
            initialOn={p.dailyBriefing.enabled}
            isAdmin={isAdmin}
            action={savePortalProfileAction}
            // The profile action patches only the fields it's sent — just this flag.
            form={(on) => toForm(switchboardFields("dailyBriefing", clientId, on))}
            confirmNotes={null}
          />
        </ul>
        {isAdmin ? null : (
          <p className="mt-3 text-xs text-muted-foreground">
            Only your account owner can turn these on or off.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function toForm(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}

function FeatureRow({
  icon: Icon,
  title,
  description,
  status,
  statusLink,
  initialOn,
  isAdmin,
  action,
  form,
  confirmNotes,
  onSaved,
  nested = false,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  status: FeatureStatus | null;
  statusLink?: { href: string; label: string };
  initialOn: boolean;
  isAdmin: boolean;
  action: ServerAction;
  form: (on: boolean) => FormData;
  /** Shown before turning ON; null = no confirmation needed (nothing reaches customers). */
  confirmNotes: string[] | null;
  onSaved?: (on: boolean) => void;
  nested?: boolean;
  children?: React.ReactNode;
}) {
  const id = useId();
  const [saved, save, pending] = useActionState(async (prevOn: boolean, next: boolean) => {
    const r = await action(initialActionState, form(next));
    if (r.ok) {
      toast.success(r.message ?? "Saved.");
      onSaved?.(next);
      return next;
    }
    toast.error(r.error ?? "Couldn't save that — please try again.");
    return prevOn;
  }, initialOn);
  const [shown, setShown] = useOptimistic(saved);
  const [confirming, setConfirming] = useState(false);

  const commit = (next: boolean) => {
    setConfirming(false);
    startTransition(() => {
      setShown(next);
      save(next);
    });
  };
  const onChange = (next: boolean) => {
    if (next && confirmNotes) setConfirming(true);
    else commit(next);
  };

  const tone = pending ? "on" : (status?.tone ?? "off");
  return (
    <li className={cn(nested ? "mt-3 rounded-lg border border-border/70 bg-muted/30 p-3" : "py-4 first:pt-2 last:pb-0")}>
      <div className="flex items-start gap-3">
        {nested ? null : (
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600">
            <Icon className="size-4" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <label htmlFor={id} className="block text-sm font-medium">
            {title}
          </label>
          <p className="text-sm text-muted-foreground">{description}</p>
          {status || pending || confirming ? (
            <p className="mt-1 flex items-start gap-2 text-xs" aria-live="polite">
              <span
                aria-hidden
                className={cn(
                  "mt-[5px] inline-block size-1.5 shrink-0 rounded-full",
                  tone === "on" ? "bg-emerald-500" : tone === "warn" ? "bg-amber-500" : "bg-muted-foreground/40",
                )}
              />
              <span className={cn("min-w-0", tone === "warn" ? "text-amber-700" : "text-muted-foreground")}>
                {pending ? "Saving…" : confirming ? "Not on yet — confirm below" : status?.text}
                {statusLink && !pending ? (
                  <>
                    {" "}
                    <Link href={statusLink.href} className="font-medium text-foreground underline underline-offset-2">
                      {statusLink.label}
                    </Link>
                  </>
                ) : null}
              </span>
            </p>
          ) : null}
        </div>
        <Switch
          id={id}
          checked={shown || confirming}
          onCheckedChange={onChange}
          disabled={!isAdmin || pending}
          aria-label={`${title}: ${shown ? "on" : "off"}`}
          className="mt-1"
        />
      </div>
      {confirming && confirmNotes ? (
        <div className="mt-3 rounded-lg border border-indigo-500/25 bg-indigo-500/5 p-3 text-sm sm:ml-11">
          <p className="font-medium">Before you turn this on</p>
          <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
            {confirmNotes.map((n) => (
              <li key={n}>· {n}</li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => commit(true)}>
              Turn on
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Not now
            </Button>
          </div>
        </div>
      ) : null}
      {children ? <div className={nested ? "" : "sm:ml-11"}>{children}</div> : null}
    </li>
  );
}
