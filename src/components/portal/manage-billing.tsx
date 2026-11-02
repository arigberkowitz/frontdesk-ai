"use client";

import { useActionState } from "react";
import { CreditCard } from "lucide-react";
import { toast } from "sonner";
import { openBillingPortalAction } from "@/lib/actions/billing";
import { initialActionState, type ActionState } from "@/lib/actions/types";
import { SubmitButton } from "@/components/form/submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** Settings card: opens Stripe's billing portal (card, invoices, cancel). */
export function ManageBilling({ clientId }: { clientId: string }) {
  const [, action, pending] = useActionState(async (prev: ActionState, fd: FormData) => {
    const next = await openBillingPortalAction(prev, fd);
    if (next.error) toast.error(next.error);
    return next;
  }, initialActionState);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Billing</CardTitle>
        <CardDescription>Update your card, download invoices, change or cancel your plan.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action}>
          <input type="hidden" name="clientId" value={clientId} />
          <SubmitButton pending={pending} size="sm">
            <CreditCard className="size-4" /> Manage billing
          </SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
