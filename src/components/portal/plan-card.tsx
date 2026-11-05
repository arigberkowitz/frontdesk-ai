"use client";

import { useActionState } from "react";
import { ArrowUpRight } from "lucide-react";
import { toast } from "sonner";
import { changePlanAction } from "@/lib/actions/billing";
import { initialActionState, type ActionState } from "@/lib/actions/types";
import { SubmitButton } from "@/components/form/submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PLANS, planList, type PlanKey } from "@/config/plans";
import type { MinutesUsage } from "@/lib/minutes";

const fmt = (cents: number) => `$${Math.round(cents / 100)}`;

/** Settings card: the plan you're on, minutes used, and switching plans. */
export function PlanCard({
  clientId,
  plan,
  usage,
  interval = "month",
}: {
  /** What they actually pay: prices are quoted per month or per year to match. */
  interval?: "month" | "year";
  clientId: string;
  plan: PlanKey;
  usage: MinutesUsage;
}) {
  const [, action, pending] = useActionState(async (prev: ActionState, fd: FormData) => {
    const next = await changePlanAction(prev, fd);
    if (next.error) toast.error(next.error);
    else if (next.message) toast.success(next.message);
    return next;
  }, initialActionState);

  const current = PLANS[plan];
  const per = interval === "year" ? "/yr" : "/mo";
  const price = (cents: number) => fmt(interval === "year" ? cents * 10 : cents) + per;
  const others = planList().filter((p) => p.key !== plan);
  const bar =
    usage.tone === "over" ? "bg-red-500" : usage.tone === "near" ? "bg-amber-500" : "bg-emerald-500";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your plan: {current?.name ?? plan}</CardTitle>
        <CardDescription>{current
            ? `${price(current.monthlyPriceCents)}${interval === "year" ? " (billed yearly)" : ""} · no overage charges`
            : null}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          {usage.percent !== null ? (
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
              <div className={`h-full ${bar}`} style={{ width: `${usage.percent}%` }} />
            </div>
          ) : null}
          <p className="text-sm text-muted-foreground" data-testid="minutes-used">
            {usage.text}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {others.map((p) => {
            const up = p.monthlyPriceCents > (current?.monthlyPriceCents ?? 0);
            return (
              <form key={p.key} action={action}>
                <input type="hidden" name="clientId" value={clientId} />
                <input type="hidden" name="plan" value={p.key} />
                <SubmitButton pending={pending} size="sm" variant={up ? "default" : "outline"}>
                  {up ? <ArrowUpRight className="size-4" /> : null}
                  {up ? "Upgrade" : "Switch"} to {p.name} · {price(p.monthlyPriceCents)}
                </SubmitButton>
              </form>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">Changes are prorated and your receptionist updates within a minute.</p>
      </CardContent>
    </Card>
  );
}
