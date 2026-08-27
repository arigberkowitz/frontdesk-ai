"use client";

import { useActionState, useEffect, useState } from "react";
import { ListChecks } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { PanelHeader } from "@/components/panel-header";
import { saveWaitlistSettingsAction } from "@/lib/actions/growth-settings";
import { initialActionState } from "@/lib/actions/types";
import { MAX_OFFERS_PER_ENTRY, MAX_PEOPLE_PER_OPENING, MIN_NOTICE_HOURS } from "@/lib/waitlist";

/**
 * Fill the gap a cancellation leaves.
 *
 * Unlike the other two switches, this one changes what the AI says on a live
 * call — so the copy says so. An owner turning this on should know their
 * receptionist is about to start making a new offer to callers.
 */
export function WaitlistCard({
  clientId,
  enabled,
  waitingCount,
  isAdmin,
}: {
  clientId: string;
  enabled: boolean;
  waitingCount: number;
  isAdmin: boolean;
}) {
  const [state, action, pending] = useActionState(saveWaitlistSettingsAction, initialActionState);
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
          icon={ListChecks}
          title="Keep a waitlist"
          description="When your AI can't offer a caller a time that works, it asks whether they'd like a text if something opens up. The moment an appointment is cancelled, the people who wanted that window hear about it."
        />

        <form action={action} className="mt-5 space-y-4">
          <input type="hidden" name="clientId" value={clientId} />

          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div>
              <label htmlFor="waitlist-enabled" className="text-sm font-medium">
                Offer a waitlist on calls
              </label>
              {enabled ? (
                <p className="text-xs text-muted-foreground">
                  {waitingCount === 0
                    ? "Nobody waiting right now."
                    : `${waitingCount} ${waitingCount === 1 ? "person" : "people"} waiting.`}
                </p>
              ) : null}
            </div>
            <Switch
              id="waitlist-enabled"
              name="enabled"
              checked={on}
              onCheckedChange={setOn}
              disabled={pending}
            />
          </div>

          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>· Up to {MAX_PEOPLE_PER_OPENING} people are told about each opening, longest-waiting first.</li>
            <li>· The text says first to reply gets it — we never promise to hold a slot.</li>
            <li>· Nobody is offered more than {MAX_OFFERS_PER_ENTRY} openings.</li>
            <li>· Never for a slot starting within {MIN_NOTICE_HOURS} hours — they couldn&rsquo;t get there.</li>
            <li>· Never to someone who replied STOP.</li>
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
