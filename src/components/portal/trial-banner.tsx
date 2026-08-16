import Link from "next/link";
import { Gift, Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import type { TrialState } from "@/lib/data/trial";
import { cn } from "@/lib/utils";

/**
 * Where a business stands on its free trial, said out loud.
 *
 * A trial that ends without warning is a bill that arrives without warning.
 * This counts down from the day they sign up, gets more insistent in the last
 * week, and after it lapses says plainly what still works and what doesn't —
 * because their calls keep being answered either way, and a business that
 * assumes otherwise will go and un-forward its phone line in a panic.
 */
export function TrialBanner({ state }: { state: TrialState }) {
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

  if (state.expired) {
    return (
      <Card className="border-amber-500/40 bg-amber-500/5">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <p className="text-sm">
            <span className="font-medium">Your free trial has ended.</span>{" "}
            <span className="text-muted-foreground">
              Your AI is still answering your calls — nothing has been switched off. Pick a plan to
              keep it that way and to make any more changes.
            </span>
          </p>
          <Link href="/portal/guidelines" className={cn(buttonVariants({ size: "sm" }))}>
            Choose a plan
          </Link>
        </CardContent>
      </Card>
    );
  }

  if (!state.active) return null;

  // The last week is when someone decides. Before that, a quiet line is plenty.
  const urgent = state.daysLeft <= 7;
  return (
    <Card className={urgent ? "border-amber-500/40 bg-amber-500/5" : undefined}>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
        <p className="flex items-center gap-2 text-sm">
          <Clock
            className={cn(
              "size-4 shrink-0",
              urgent ? "text-amber-600 dark:text-amber-500" : "text-muted-foreground",
            )}
          />
          <span>
            <span className="font-medium">
              {state.daysLeft === 0
                ? "Last day of your free trial"
                : `${state.daysLeft} day${state.daysLeft === 1 ? "" : "s"} left in your free trial`}
            </span>{" "}
            <span className="text-muted-foreground">
              — everything works, and we haven&apos;t asked for a card.
            </span>
          </span>
        </p>
        <Link
          href="/portal/guidelines"
          className={cn(buttonVariants({ size: "sm", variant: urgent ? "default" : "outline" }))}
        >
          {urgent ? "Choose a plan" : "See plans"}
        </Link>
      </CardContent>
    </Card>
  );
}
