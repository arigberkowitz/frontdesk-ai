"use client";

import { useActionState, useEffect, useState } from "react";
import { PhoneMissed } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { PanelHeader } from "@/components/panel-header";
import { saveMissedCallSettingsAction } from "@/lib/actions/missed-call-settings";
import { initialActionState } from "@/lib/actions/types";
import { DEDUPE_DAYS, MAX_CALLBACKS_PER_CLIENT_PER_DAY, callbackText } from "@/lib/missed-call";

/**
 * Settings → Follow-ups: text back callers who hung up early, got cut off, or
 * left mid-booking. Off by default. The AI phone-callback switch only appears
 * usable when the platform has enabled it.
 */
export function MissedCallCard({
  clientId,
  businessName,
  enabled,
  aiCallbacksEnabled,
  aiCallbacksAvailable,
  stats,
  isAdmin,
}: {
  clientId: string;
  businessName: string;
  enabled: boolean;
  aiCallbacksEnabled: boolean;
  aiCallbacksAvailable: boolean;
  stats: { sent: number; skipped: number; pending: number; failed: number };
  isAdmin: boolean;
}) {
  const [state, action, pending] = useActionState(saveMissedCallSettingsAction, initialActionState);
  const [on, setOn] = useState(enabled);
  const [aiOn, setAiOn] = useState(aiCallbacksEnabled);

  useEffect(() => {
    if (state.ok && state.message) toast.success(state.message);
    else if (state.error) toast.error(state.error);
  }, [state]);

  if (!isAdmin) return null;

  return (
    <Card>
      <CardContent className="p-5 sm:p-6">
        <PanelHeader
          icon={PhoneMissed}
          title="Text back missed callers"
          description="When someone hangs up before your AI could help, the call drops, or they leave halfway through booking, we text them a few minutes later offering to finish by reply."
        />

        <form action={action} className="mt-5 space-y-4">
          <input type="hidden" name="clientId" value={clientId} />

          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <label htmlFor="missed-call-enabled" className="text-sm font-medium">
              Text back missed and dropped calls
            </label>
            <Switch
              id="missed-call-enabled"
              name="enabled"
              checked={on}
              onCheckedChange={setOn}
              disabled={pending}
            />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div className="space-y-0.5">
              <label htmlFor="missed-call-ai" className="text-sm font-medium">
                Have the AI call them back instead
              </label>
              <p className="text-xs text-muted-foreground">
                {aiCallbacksAvailable
                  ? "Your AI phones them from your number and says it's an AI. If the call can't be placed, they get the text."
                  : "Not available on your account yet."}
              </p>
            </div>
            <Switch
              id="missed-call-ai"
              name="aiCallbacks"
              checked={aiCallbacksAvailable && on && aiOn}
              onCheckedChange={setAiOn}
              disabled={pending || !aiCallbacksAvailable || !on}
            />
          </div>

          <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">What they get: </span>
            {callbackText({ businessName, reason: "hung_up_early" })}
          </div>

          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>· Only to callers who&rsquo;ve agreed to texts from you, and never after STOP.</li>
            <li>· Never to spam or blocked numbers, or anyone already booked or who called back.</li>
            <li>· One text per caller every {DEDUPE_DAYS} days, at most {MAX_CALLBACKS_PER_CLIENT_PER_DAY} a day.</li>
            <li>· 9am–8pm their time; a late-night call gets its text the next day.</li>
            <li>· Replies land in Messages (and AI text replies answers them, if that&rsquo;s on).</li>
          </ul>

          {enabled ? (
            <p className="text-sm text-muted-foreground">
              Last 7 days: {stats.sent} sent
              {stats.pending ? `, ${stats.pending} waiting for daytime` : ""}
              {stats.failed ? `, ${stats.failed} failed` : ""}, {stats.skipped} calls didn&rsquo;t need one.
            </p>
          ) : null}

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
