"use client";

import { useActionState, useState, startTransition } from "react";
import Link from "next/link";
import { Check, CreditCard } from "lucide-react";
import { toast } from "sonner";
import { startSelfServeCheckoutAction } from "@/lib/actions/billing";
import { initialActionState, type ActionState } from "@/lib/actions/types";
import { planList, minutesLabel, PLANS, type PlanKey } from "@/config/plans";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrencyCents } from "@/lib/format";
import { cn } from "@/lib/utils";

// Whatever is actually on sale, in the order the pricing page shows it.
const ORDER: PlanKey[] = planList().map((p) => p.key);

/**
 * Pick a plan, pay, go live — without anybody at FrontDesk touching anything.
 *
 * This is the piece that was missing. Four plans were advertised on the public
 * pricing page and none of them could be bought: the only checkout in the
 * codebase required an operator, so a business that signed up on the website
 * hit a code box for a code that only existed in someone's head.
 *
 * No setup fee here, and it says so — they're doing the setup themselves, which
 * is precisely what the fee covers when we do it.
 */
export function ChoosePlan({
  clientId,
  cardsReady,
  testMode,
  preselect,
}: {
  clientId: string;
  /** The plan they picked on the pricing page, if they came that way. */
  preselect?: string | null;
  /** Is Stripe actually configured on the server? */
  cardsReady: boolean;
  /** True on a Stripe test key — say so, loudly, so nobody thinks they paid. */
  testMode: boolean;
}) {
  const [selected, setSelected] = useState<PlanKey>(
    ORDER.includes(preselect as PlanKey) ? (preselect as PlanKey) : "starter",
  );
  const [yearly, setYearly] = useState(false);
  const [, action, pending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const next = await startSelfServeCheckoutAction(prev, formData);
      // Success is a redirect to Stripe, so anything that comes back is a problem.
      if (next.error) toast.error(next.error);
      return next;
    },
    initialActionState,
  );

  const price = (key: PlanKey) => {
    const cents = PLANS[key].monthlyPriceCents;
    return yearly ? cents * 10 : cents;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Turn your receptionist on</CardTitle>
        <CardDescription>
          Everything you&apos;ve set up is saved and waiting. Pick a plan and it goes live on your
          own phone number — usually within a couple of minutes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2 text-sm">
          <Button
            type="button"
            variant={yearly ? "ghost" : "outline"}
            size="sm"
            onClick={() => setYearly(false)}
          >
            Monthly
          </Button>
          <Button
            type="button"
            variant={yearly ? "outline" : "ghost"}
            size="sm"
            onClick={() => setYearly(true)}
          >
            Yearly — two months free
          </Button>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {ORDER.map((key) => {
            const plan = PLANS[key];
            const active = selected === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setSelected(key)}
                aria-pressed={active}
                className={cn(
                  "rounded-lg border p-3 text-left transition-colors",
                  active ? "border-indigo-500/40 bg-indigo-500/5" : "hover:bg-muted/50",
                )}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">{plan.name}</span>
                  <span className="text-sm font-semibold">
                    {formatCurrencyCents(price(key))}
                    <span className="text-xs font-normal text-muted-foreground">
                      /{yearly ? "yr" : "mo"}
                    </span>
                  </span>
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">{plan.description}</span>
                {/* The same volume-and-no-overage line the public cards carry.
                    Somebody about to enter a card number is the last person who
                    should have to wonder what happens on a busy month. */}
                <span className="mt-1 block text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  {minutesLabel(plan)}
                </span>
                {active ? (
                  <span className="mt-2 block space-y-0.5">
                    {plan.highlights.map((h) => (
                      <span key={h} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                        <Check className="mt-0.5 size-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
                        {h}
                      </span>
                    ))}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            startTransition(() => action(fd));
          }}
          className="space-y-2"
        >
          <input type="hidden" name="clientId" value={clientId} />
          <input type="hidden" name="plan" value={selected} />
          <input type="hidden" name="interval" value={yearly ? "year" : "month"} />
          {/* A Continue button that can only ever produce an error is worse than
              no button. When card payments aren't switched on, say so here
              rather than after they've picked a plan and pressed it. */}
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={pending || !cardsReady}
          >
            <CreditCard className="size-4" />
            {!cardsReady
              ? "Card payments aren't switched on yet"
              : pending
                ? "Opening payment…"
                : `Continue — ${formatCurrencyCents(price(selected))}/${yearly ? "yr" : "mo"}`}
          </Button>
          {!cardsReady ? (
            <p className="text-xs text-muted-foreground">
              Nothing wrong on your end — we haven&apos;t finished switching card payments on.{" "}
              <Link href="/contact" className="underline underline-offset-2">
                Tell us
              </Link>{" "}
              and we&apos;ll sort your plan out by hand.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {testMode ? (
                <span className="font-medium text-amber-600 dark:text-amber-500">
                  Test mode — no real money moves.{" "}
                </span>
              ) : null}
              No setup fee — you&apos;ve done the setup yourself. Cancel anytime from Settings; you
              keep your number until the end of the period you&apos;ve paid for.
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

/** "I was given a code" / "can I try it first" — kept small and underneath. */
export function TrialFooterNote() {
  return (
    <p className="text-xs text-muted-foreground">
      Been given a trial code, or want to try it before paying?{" "}
      <Link href="/contact" className="underline underline-offset-2">
        Get in touch
      </Link>
      .
    </p>
  );
}
