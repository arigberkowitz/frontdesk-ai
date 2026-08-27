"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { PanelHeader } from "@/components/panel-header";
import { saveRecallSettingsAction } from "@/lib/actions/growth-settings";
import { initialActionState } from "@/lib/actions/types";
import { RECALL_LEAD_DAYS, RECALL_MIN_DAYS_BETWEEN } from "@/lib/recall";

/**
 * Invite past customers back when they're due.
 *
 * The interval isn't set here — it's set per service, because "six months"
 * is a fact about a cleaning rather than about a dental practice. The card
 * links there instead of duplicating the control, and names the count of
 * services that currently qualify so "nothing happened" is never a mystery.
 */
export function RecallCard({
  clientId,
  enabled,
  recallServiceCount,
  isAdmin,
}: {
  clientId: string;
  enabled: boolean;
  recallServiceCount: number;
  isAdmin: boolean;
}) {
  const [state, action, pending] = useActionState(saveRecallSettingsAction, initialActionState);
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
          icon={RotateCcw}
          title="Invite customers back"
          description="When someone is due for their next visit, we text and offer to rebook them. This is the difference between a phone that gets answered and a calendar that stays full."
        />

        <form action={action} className="mt-5 space-y-4">
          <input type="hidden" name="clientId" value={clientId} />

          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <label htmlFor="recall-enabled" className="text-sm font-medium">
              Send rebooking invitations
            </label>
            <Switch
              id="recall-enabled"
              name="enabled"
              checked={on}
              onCheckedChange={setOn}
              disabled={pending}
            />
          </div>

          <p className="text-sm text-muted-foreground">
            {recallServiceCount > 0 ? (
              <>
                {recallServiceCount} of your services{" "}
                {recallServiceCount === 1 ? "has" : "have"} a rebook interval set.
              </>
            ) : (
              <>No service has a rebook interval yet, so nobody would be texted.</>
            )}{" "}
            <Link href="/portal/services" className="underline underline-offset-2">
              Set it on Services
            </Link>{" "}
            — 180 days for a cleaning, 28 for a haircut. Leave it empty for one-off work.
          </p>

          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>· Sent up to {RECALL_LEAD_DAYS} days before they&rsquo;re due, so there are still slots left.</li>
            <li>· Never to someone who already has an appointment booked.</li>
            <li>· At most one invitation per customer every {RECALL_MIN_DAYS_BETWEEN} days.</li>
            <li>· Daytime only, and never to someone who replied STOP.</li>
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
