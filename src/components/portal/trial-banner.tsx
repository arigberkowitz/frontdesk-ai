import Link from "next/link";
import { CalendarCheck, Clock, Gift, MoonStar, PhoneIncoming } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import type { TrialState } from "@/lib/data/trial";
import { daysLeftLabel, trialSummaryLine, type TrialProgress } from "@/lib/trial-progress";
import { formatCurrencyCents } from "@/lib/format";
import { TRIAL_DAYS } from "@/config/plans";
import { UpgradeButton } from "@/components/portal/upgrade-button";
import { TrialReminderToggle } from "@/components/portal/trial-reminder-toggle";
import { cn } from "@/lib/utils";

export interface TrialUpgrade {
  clientId: string;
  plan: { key: string; name: string; monthlyPriceCents: number };
  /** The owner, with card payments switched on: the button opens Stripe Checkout. */
  canCheckout: boolean;
}

/**
 * Where a business stands on its free trial, said out loud — with what the AI
 * has actually done this trial and one button to keep it.
 *
 * A trial that ends without warning is a bill that arrives without warning.
 * This counts down from the day they sign up, gets more insistent in the last
 * three days, and after it lapses says plainly what still works and what
 * doesn't — because their calls keep being answered either way, and a business
 * that assumes otherwise will go and un-forward its phone line in a panic.
 */
export function TrialBanner({
  state,
  progress = null,
  hasNumber = false,
  upgrade = null,
  reminder = null,
  timezone,
}: {
  state: TrialState;
  /** Real calls/bookings since the trial started (data/trial-progress.ts). */
  progress?: TrialProgress | null;
  hasNumber?: boolean;
  upgrade?: TrialUpgrade | null;
  /** Owner-only opt-in for the 3-days-left email. */
  reminder?: { clientId: string; on: boolean } | null;
  /** The business's timezone, so "Ends Fri, Oct 16" is their date, not the server's. */
  timezone?: string;
}) {
  if (state.subscribed) return null;

  if (state.comped) {
    // Permanent good news doesn't need a billboard. One quiet line, forever.
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Gift className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <span>
          <span className="font-medium text-foreground">You&apos;re on the house</span> — full
          product, nothing to pay, nobody will ask for a card.
        </span>
      </p>
    );
  }

  const cta = (urgent: boolean) =>
    upgrade?.canCheckout ? (
      <UpgradeButton
        clientId={upgrade.clientId}
        planKey={upgrade.plan.key}
        label={`Upgrade to ${upgrade.plan.name} · ${formatCurrencyCents(upgrade.plan.monthlyPriceCents)}/mo`}
      />
    ) : (
      <Link
        href="/portal/guidelines#plans"
        className={cn(buttonVariants({ size: "sm", variant: urgent ? "default" : "outline" }))}
      >
        Choose a plan
      </Link>
    );

  if (state.expired) {
    return (
      <Card className="border-amber-500/40 bg-amber-500/5" data-testid="trial-banner">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <p className="text-sm">
            <span className="font-medium">Your free trial has ended.</span>{" "}
            <span className="text-muted-foreground">
              {progress && progress.calls > 0 ? `${trialSummaryLine(progress, hasNumber)} ` : ""}
              Your AI is still answering your calls — nothing has been switched off. Pick a plan to
              keep it that way and to make any more changes.
            </span>
          </p>
          {cta(true)}
        </CardContent>
      </Card>
    );
  }

  if (!state.active) return null;

  const urgent = state.daysLeft <= 3;
  const elapsed = Math.min(1, Math.max(0, (TRIAL_DAYS - state.daysLeft) / TRIAL_DAYS));
  const stats = progress
    ? [
        { icon: PhoneIncoming, label: "Calls handled", value: progress.calls },
        { icon: CalendarCheck, label: "Appointments booked", value: progress.booked },
        { icon: MoonStar, label: "After-hours calls", value: progress.afterHours },
      ]
    : [];

  return (
    <Card
      data-testid="trial-banner"
      className={cn("overflow-hidden", urgent ? "border-amber-500/40 bg-amber-500/5" : "fd-glass")}
    >
      <CardContent className="space-y-4 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-heading text-base font-semibold">
              <Clock
                className={cn("size-4 shrink-0", urgent ? "text-amber-600" : "text-brand")}
              />
              {daysLeftLabel(state.daysLeft)}
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Everything works, and we haven&apos;t asked for a card.
              {state.endsAt
                ? ` Ends ${state.endsAt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: timezone })}.`
                : ""}
            </p>
          </div>
          {cta(urgent)}
        </div>

        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label="Free trial used"
          aria-valuemin={0}
          aria-valuemax={TRIAL_DAYS}
          aria-valuenow={TRIAL_DAYS - state.daysLeft}
        >
          <div
            className={cn("h-full rounded-full", urgent ? "bg-amber-500" : "bg-gradient-to-r from-violet-500 to-cyan-500")}
            style={{ width: `${Math.max(4, elapsed * 100)}%` }}
          />
        </div>

        {progress ? (
          <div className="space-y-3">
            <p className="fd-section-label">This trial so far</p>
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {stats.map((s) => (
                <div key={s.label} className="rounded-xl border bg-background/70 p-3">
                  <s.icon className="size-4 text-brand" />
                  <p className="mt-1.5 font-heading text-2xl font-semibold tabular-nums">{s.value}</p>
                  <p className="text-xs leading-tight text-muted-foreground">{s.label}</p>
                </div>
              ))}
            </div>
            <p className="text-sm">{trialSummaryLine(progress, hasNumber)}</p>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link
            href="/portal/guidelines#plans"
            className="text-xs font-medium underline underline-offset-2"
          >
            Compare plans
          </Link>
          {reminder ? <TrialReminderToggle clientId={reminder.clientId} on={reminder.on} /> : null}
        </div>
      </CardContent>
    </Card>
  );
}
