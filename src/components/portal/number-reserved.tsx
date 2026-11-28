import Link from "next/link";
import { CreditCard, Lock, PhoneCall } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import type { NumberLockReason } from "@/lib/number-gate";
import { cn } from "@/lib/utils";

/**
 * "Your phone number is one step away" — and which step.
 *
 * A free trial gets its own phone number once the owner has made one test
 * call (number-gate.ts). This says so plainly, with the one thing to do next,
 * so nobody sits waiting for a number that isn't coming on its own:
 *   - trial, no test call yet → make the test call (the button is right below);
 *   - today's trial-number cap is used up → try again tomorrow, or message us;
 *   - trial over / no plan → pick a plan.
 */
export function NumberReserved({
  reason,
  trialEndsOn = null,
  plansHref = "/portal/guidelines?plans=open#plans",
}: {
  reason: NumberLockReason;
  /** When the free trial ends, formatted ("December 9"); null when not on one. */
  trialEndsOn?: string | null;
  plansHref?: string;
}) {
  const copy: Record<NumberLockReason, { title: string; body: string }> = {
    needs_test_call: {
      title: "Make one test call to get your phone number",
      body: `Talk to your AI in your browser below, even for 30 seconds. When you hang up, your AI's own phone number is set up for you, free for the rest of your trial${trialEndsOn ? ` (until ${trialEndsOn})` : ""}. It shows up here within a minute.`,
    },
    daily_cap: {
      title: "Your number is next in line",
      body: "We've set up a lot of new numbers today, so yours will be ready tomorrow: come back then and press Get my phone number here, or message us from Settings → Help and we'll do it for you. Your AI works in your browser right now.",
    },
    trial_ended: {
      title: "Pick a plan to get your phone number",
      body: "Your free trial has ended. Everything you set up is kept: pick a plan and your AI gets its own phone number within a minute.",
    },
    needs_plan: {
      title: "Pick a plan to get your phone number",
      body: "Your AI is built and you can talk to it in your browser right now. Pick a plan and its own phone number is set up within a minute.",
    },
  };
  const { title, body } = copy[reason];

  return (
    <div
      role="status"
      className="rounded-xl border border-brand/25 bg-brand-soft/60 p-4 text-sm"
      data-testid="number-reserved"
    >
      <p className="flex items-center gap-2 font-medium">
        {reason === "needs_test_call" ? (
          <PhoneCall className="size-4 shrink-0 text-brand" />
        ) : (
          <Lock className="size-4 shrink-0 text-brand" />
        )}
        {title}
      </p>
      <p className="mt-1 text-muted-foreground">{body}</p>
      {reason === "needs_test_call" ? (
        <Link href="#test-call" className={cn(buttonVariants({ size: "sm" }), "fd-cta-glow mt-3")}>
          <PhoneCall className="size-4" />
          Go to the test call
        </Link>
      ) : reason === "trial_ended" || reason === "needs_plan" ? (
        <Link href={plansHref} className={cn(buttonVariants({ size: "sm" }), "fd-cta-glow mt-3")}>
          <CreditCard className="size-4" />
          Pick a plan
        </Link>
      ) : null}
    </div>
  );
}
