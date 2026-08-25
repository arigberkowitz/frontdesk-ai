"use client";

import { useActionState, useEffect, useState } from "react";
import { Download, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PanelHeader } from "@/components/panel-header";
import { closeAccountAction } from "@/lib/actions/account";
import { initialActionState } from "@/lib/actions/types";
import { SUPPORT_EMAIL } from "@/config/contact";
import { cn } from "@/lib/utils";

/**
 * Take your data, or leave.
 *
 * Both halves of this card were promises the privacy policy made and the
 * product did not keep: §10 says customers can access, export and delete their
 * information "directly in the product", and until now the only export lived
 * behind an operator-only route and the only delete was a button on a screen
 * customers cannot open. A business could get its data out and get itself out
 * only by asking a person and waiting.
 *
 * Export sits above Close on purpose. Someone who has decided to leave should
 * walk past the button that lets them take their calls, bookings and leads with
 * them before they reach the one that ends it.
 */
export function DangerZone({
  clientId,
  businessName,
  isAdmin,
}: {
  clientId: string;
  businessName: string;
  isAdmin: boolean;
}) {
  const [state, action, pending] = useActionState(closeAccountAction, initialActionState);
  const [armed, setArmed] = useState(false);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (state.ok) toast.success(state.message ?? "Done.");
    else if (state.error) toast.error(state.error);
  }, [state]);

  const exports = [
    { type: "calls", label: "Calls" },
    { type: "appointments", label: "Appointments" },
    { type: "leads", label: "Leads" },
  ];

  return (
    <Card className="border-destructive/30">
      <CardContent className="space-y-5 p-5 sm:p-6">
        <PanelHeader
          icon={Download}
          title="Your data"
          description="Everything your receptionist has captured, as spreadsheets you can open anywhere. Yours to take, any time, with or without an account here."
        />
        <div className="flex flex-wrap gap-2">
          {exports.map((e) => (
            // A plain link, not fetch(): the browser's own download handling is
            // the one thing guaranteed to work on every phone.
            <a
              key={e.type}
              href={`/api/clients/${clientId}/export?type=${e.type}`}
              download
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              <Download className="size-3.5" />
              {e.label} (CSV)
            </a>
          ))}
        </div>

        {isAdmin ? (
          <div className="space-y-4 border-t pt-5">
            <PanelHeader
              icon={TriangleAlert}
              title="Close this account"
              description="Your AI receptionist stops answering immediately. Your calls, bookings, leads and settings are kept for 90 days in case you change your mind, then permanently deleted. Billing stops — cancel your card in the billing portal separately if you have a subscription."
            />
            {!armed ? (
              <div className="flex justify-end">
                <Button type="button" variant="outline" size="sm" onClick={() => setArmed(true)}>
                  Close account
                </Button>
              </div>
            ) : (
              <form action={action} className="space-y-3">
                <input type="hidden" name="clientId" value={clientId} />
                <label className="block text-sm" htmlFor="confirm">
                  Type <span className="font-semibold">{businessName}</span> to confirm.
                </label>
                <Input
                  id="confirm"
                  name="confirm"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  autoComplete="off"
                  placeholder={businessName}
                  aria-invalid={Boolean(state.fieldErrors?.confirm)}
                />
                {state.fieldErrors?.confirm ? (
                  <p className="text-sm text-destructive">{state.fieldErrors.confirm[0]}</p>
                ) : null}
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setArmed(false);
                      setTyped("");
                    }}
                  >
                    Never mind
                  </Button>
                  <Button type="submit" variant="destructive" size="sm" disabled={pending}>
                    {pending ? "Closing…" : "Close account permanently"}
                  </Button>
                </div>
              </form>
            )}
            <p className="text-xs text-muted-foreground">
              Changed your mind after closing? Email{" "}
              <a href={`mailto:${SUPPORT_EMAIL}`} className="underline underline-offset-2">
                {SUPPORT_EMAIL}
              </a>{" "}
              within 90 days and it can be brought back exactly as it was.
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
