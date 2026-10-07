"use client";

import { useActionState } from "react";
import { CreditCard } from "lucide-react";
import { toast } from "sonner";
import { startSelfServeCheckoutAction } from "@/lib/actions/billing";
import { initialActionState, type ActionState } from "@/lib/actions/types";
import { SubmitButton } from "@/components/form/submit-button";
import { cn } from "@/lib/utils";

/**
 * Straight to Stripe Checkout on the plan they picked at signup (else
 * Starter), monthly — the same self-serve checkout as the plan cards on Your
 * AI, so the webhook and "already subscribed" guard all apply unchanged.
 */
export function UpgradeButton({
  clientId,
  planKey,
  label,
  size = "sm",
  className,
}: {
  clientId: string;
  planKey: string;
  label: string;
  size?: "sm" | "default";
  className?: string;
}) {
  const [, action, pending] = useActionState(async (prev: ActionState, fd: FormData) => {
    const next = await startSelfServeCheckoutAction(prev, fd);
    // Success is a redirect to Stripe; anything that comes back is a problem.
    if (next.error) toast.error(next.error);
    return next;
  }, initialActionState);

  return (
    <form action={action} className="shrink-0">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="plan" value={planKey} />
      <input type="hidden" name="interval" value="month" />
      <SubmitButton pending={pending} size={size} className={cn("fd-cta-glow", className)}>
        <CreditCard className="size-4" />
        {label}
      </SubmitButton>
    </form>
  );
}
