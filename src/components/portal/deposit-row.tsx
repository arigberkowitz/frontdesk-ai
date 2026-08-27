"use client";

import { useActionState, useEffect } from "react";
import { Banknote } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { setDepositStatusAction } from "@/lib/actions/appointments";
import { initialActionState } from "@/lib/actions/types";
import { formatDeposit } from "@/lib/deposits";

const LABEL: Record<string, string> = {
  requested: "Deposit sent",
  paid: "Deposit paid",
  waived: "Deposit waived",
};

/**
 * Where a deposit stands, and the two buttons that move it.
 *
 * Marking is manual because the money went straight to the business's own
 * Stripe or Square — this app never sees it land, which is the price of staying
 * out of other people's money and is stated plainly rather than hidden behind a
 * spinner that never resolves.
 */
export function DepositRow({
  clientId,
  appointmentId,
  status,
  amountCents,
}: {
  clientId: string;
  appointmentId: string;
  status: string;
  amountCents: number | null;
}) {
  const [state, action, pending] = useActionState(setDepositStatusAction, initialActionState);

  useEffect(() => {
    if (state.ok && state.message) toast.success(state.message);
    else if (state.error) toast.error(state.error);
  }, [state]);

  if (status === "not_required") return null;

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 text-sm font-medium">
          <Banknote className="size-4 text-muted-foreground" />
          {amountCents ? formatDeposit(amountCents) : "Deposit"}
        </span>
        <Badge variant="secondary">{LABEL[status] ?? status}</Badge>
      </div>
      {status !== "paid" ? (
        <form action={action} className="flex flex-wrap justify-end gap-2">
          <input type="hidden" name="clientId" value={clientId} />
          <input type="hidden" name="appointmentId" value={appointmentId} />
          <Button
            type="submit"
            name="depositStatus"
            value="waived"
            variant="ghost"
            size="sm"
            disabled={pending}
          >
            Waive
          </Button>
          <Button
            type="submit"
            name="depositStatus"
            value="paid"
            variant="outline"
            size="sm"
            disabled={pending}
          >
            Mark paid
          </Button>
        </form>
      ) : null}
    </div>
  );
}
