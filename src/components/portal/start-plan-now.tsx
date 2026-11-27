"use client";

import { useActionState, useEffect } from "react";
import { CreditCard } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { SubmitButton } from "@/components/form/submit-button";
import { startPlanNowAction } from "@/lib/actions/billing";
import { initialActionState } from "@/lib/actions/types";

/**
 * "Start my plan now." A business that saved a card during its free trial
 * keeps the rest of its trial days, and its card is first charged when they
 * run out (billing-trial.ts). This lets the owner choose not to wait — Stripe
 * charges the saved card today and the trial ends now.
 */
export function StartPlanNow({
  clientId,
  firstChargeOn = null,
}: {
  clientId: string;
  /** When the saved card is first charged, already formatted ("December 9"). */
  firstChargeOn?: string | null;
}) {
  const [state, action, pending] = useActionState(startPlanNowAction, initialActionState);
  useEffect(() => {
    if (state.ok && state.message) toast.success(state.message);
    else if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <Card data-testid="start-plan-now">
      <CardContent className="flex flex-col gap-3 py-4 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p>
          <span className="font-medium">Your card is saved.</span>{" "}
          <span className="text-muted-foreground">
            Your free trial carries on and your first charge is{" "}
            {firstChargeOn ? `on ${firstChargeOn}` : "at the end of your free trial"}. Done
            trying it out? Start your plan today instead.
          </span>
        </p>
        <form action={action} className="shrink-0">
          <input type="hidden" name="clientId" value={clientId} />
          <SubmitButton pending={pending} size="sm" variant="outline">
            <CreditCard className="size-4" />
            Start my plan now
          </SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
