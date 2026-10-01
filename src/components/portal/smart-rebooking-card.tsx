"use client";

import { useActionState, useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { PanelHeader } from "@/components/panel-header";
import { saveSmartRebookingSettingsAction } from "@/lib/actions/rebooking";
import { initialActionState } from "@/lib/actions/types";
import { REBOOK_OFFER_HOURS } from "@/lib/rebook";

/** Settings → Follow-ups: let the owner ask affected customers to pick a new time. Off by default. */
export function SmartRebookingCard({
  clientId,
  enabled,
  isAdmin,
}: {
  clientId: string;
  enabled: boolean;
  isAdmin: boolean;
}) {
  const [state, action, pending] = useActionState(saveSmartRebookingSettingsAction, initialActionState);
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
          icon={CalendarClock}
          title="Rebook when you block time"
          description="When you add time off over existing bookings, the Hours page lists who's affected. With this on, you can have us text them 2–3 new times — they reply 1, 2 or 3 and it's moved, or NO to cancel."
        />
        <form action={action} className="mt-5 space-y-4">
          <input type="hidden" name="clientId" value={clientId} />
          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <label htmlFor="smart-rebooking-enabled" className="text-sm font-medium">
              Offer new times by text
            </label>
            <Switch
              id="smart-rebooking-enabled"
              name="enabled"
              checked={on}
              onCheckedChange={setOn}
              disabled={pending}
            />
          </div>
          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>· Nothing is sent until you press &ldquo;Ask customers to rebook&rdquo; and confirm.</li>
            <li>· Only to customers who agreed to texts about their booking, never after STOP, 9am–8pm.</li>
            <li>· Times offered are real openings on your calendar, re-checked when they reply.</li>
            <li>· Offers stay open {REBOOK_OFFER_HOURS} hours. Anything other than 1/2/3/NO comes to you in Messages.</li>
            <li>· A cancelled slot goes to your waitlist (if on) when it&rsquo;s still bookable.</li>
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
