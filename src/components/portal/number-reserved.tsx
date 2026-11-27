"use client";

import Link from "next/link";
import { useActionState, useEffect } from "react";
import { CreditCard, Lock } from "lucide-react";
import { toast } from "sonner";
import { buttonVariants } from "@/components/ui/button";
import { SubmitButton } from "@/components/form/submit-button";
import { startPlanNowAction } from "@/lib/actions/billing";
import { initialActionState } from "@/lib/actions/types";
import { cn } from "@/lib/utils";

/**
 * "Add a card to get your number."
 *
 * A self-serve business gets its receptionist at signup but not its phone
 * number: that waits for the first real payment (number-gate.ts). This says so
 * plainly, points at the browser test call that works today, and — for a
 * business that saved a card during its free trial — offers to start the paid
 * plan now instead of waiting for the trial to run out.
 */
export function NumberReserved({
  clientId,
  awaitingFirstCharge = false,
  firstChargeOn = null,
  plansHref = "/portal/guidelines?plans=open#plans",
}: {
  clientId: string;
  /** A card is on file (Stripe trial); the first charge is still ahead. */
  awaitingFirstCharge?: boolean;
  /** When that first charge is due, already formatted ("December 9"). */
  firstChargeOn?: string | null;
  plansHref?: string;
}) {
  const [state, action, pending] = useActionState(startPlanNowAction, initialActionState);
  useEffect(() => {
    if (state.ok && state.message) toast.success(state.message);
    else if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <div
      role="status"
      className="rounded-xl border border-brand/25 bg-brand-soft/60 p-4 text-sm"
      data-testid="number-reserved"
    >
      <p className="flex items-center gap-2 font-medium">
        <Lock className="size-4 shrink-0 text-brand" />
        {awaitingFirstCharge
          ? "Your number is assigned when your first payment goes through"
          : "Add a card to get your phone number"}
      </p>
      <p className="mt-1 text-muted-foreground">
        {awaitingFirstCharge
          ? `Your card is saved and your first charge is ${firstChargeOn ? `on ${firstChargeOn}` : "at the end of your free trial"}. Until then you can talk to your AI in your browser. Want the number today? Start your plan now and the charge happens today instead.`
          : "Your AI is built and you can talk to it in your browser right now. Its own phone number is assigned as soon as your first payment goes through."}
      </p>
      <div className="mt-3">
        {awaitingFirstCharge ? (
          <form action={action}>
            <input type="hidden" name="clientId" value={clientId} />
            <SubmitButton pending={pending} size="sm">
              <CreditCard className="size-4" />
              Start my plan now
            </SubmitButton>
          </form>
        ) : (
          <Link href={plansHref} className={cn(buttonVariants({ size: "sm" }), "fd-cta-glow")}>
            <CreditCard className="size-4" />
            Pick a plan
          </Link>
        )}
      </div>
    </div>
  );
}
