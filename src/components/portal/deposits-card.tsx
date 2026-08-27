"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { Banknote } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { PanelHeader } from "@/components/panel-header";
import { saveDepositSettingsAction } from "@/lib/actions/growth-settings";
import { initialActionState } from "@/lib/actions/types";

/**
 * Ask for a deposit on the bookings where a no-show hurts.
 *
 * The copy is explicit that the money goes to them, not through us, because
 * that is the first question any owner will have and the honest answer is also
 * the reassuring one.
 */
export function DepositsCard({
  clientId,
  enabled,
  depositLinkUrl,
  depositServiceCount,
  isAdmin,
}: {
  clientId: string;
  enabled: boolean;
  depositLinkUrl: string | null;
  depositServiceCount: number;
  isAdmin: boolean;
}) {
  const [state, action, pending] = useActionState(saveDepositSettingsAction, initialActionState);
  const [on, setOn] = useState(enabled);

  useEffect(() => {
    if (state.ok && state.message) toast.success(state.message);
    else if (state.error) toast.error(state.error);
  }, [state]);

  if (!isAdmin) return null;

  return (
    <Card>
      <CardContent className="p-5 sm:p-6">
        <PanelHeader
          icon={Banknote}
          title="Take a deposit"
          description="Right after a booking that needs one, we text the customer your payment link. A small deposit is the only thing that reliably stops no-shows."
        />

        <form action={action} className="mt-5 space-y-4">
          <input type="hidden" name="clientId" value={clientId} />

          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <label htmlFor="deposits-enabled" className="text-sm font-medium">
              Send deposit requests
            </label>
            <Switch
              id="deposits-enabled"
              name="enabled"
              checked={on}
              onCheckedChange={setOn}
              disabled={pending}
            />
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium" htmlFor="depositLinkUrl">
              Your payment link
            </label>
            <Input
              id="depositLinkUrl"
              name="depositLinkUrl"
              type="url"
              defaultValue={depositLinkUrl ?? ""}
              placeholder="https://buy.stripe.com/…"
              autoComplete="off"
              aria-invalid={Boolean(state.fieldErrors?.depositLinkUrl)}
            />
            {state.fieldErrors?.depositLinkUrl ? (
              <p className="text-sm text-destructive">{state.fieldErrors.depositLinkUrl[0]}</p>
            ) : null}
            {/* The first question every owner asks, answered before they ask. */}
            <p className="text-xs text-muted-foreground">
              The money goes straight to you — this is your own Stripe, Square or PayPal link, and
              it never passes through FrontDesk AI. We just send it at the right moment.
            </p>
          </div>

          <p className="text-sm text-muted-foreground">
            {depositServiceCount > 0 ? (
              <>
                {depositServiceCount}{" "}
                {depositServiceCount === 1 ? "service asks" : "services ask"} for a deposit.
              </>
            ) : (
              <>No service asks for a deposit yet, so nothing would be sent.</>
            )}{" "}
            <Link href="/portal/services" className="underline underline-offset-2">
              Set the amount on Services
            </Link>
            .
          </p>

          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>· Only sent to callers who agreed to be texted on the call.</li>
            <li>· The booking is confirmed either way — we never threaten to drop it.</li>
            <li>· Mark it paid on the appointment once the money lands.</li>
          </ul>

          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
