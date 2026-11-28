"use client";

import { skipBreakdown } from "@/lib/missed-call-skips";
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
import { WhatsThis } from "@/components/portal/feature-explainer";

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
  stats: { sent: number; skipped: number; pending: number; failed: number; skippedBy?: Record<string, number> };
  isAdmin: boolean;
}) {
  const [state, action, pending] = useActionState(saveMissedCallSettingsAction, initialActionState);
  const [on, setOn] = useState(enabled);
  const [aiOn, setAiOn] = useState(aiCallbacksEnabled);
  const skips = skipBreakdown(stats.skippedBy ?? {});
  const noConsent = stats.skippedBy?.no_consent ?? 0;

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
        <WhatsThis feature="missedCallTexts" className="sm:ml-12" />

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

          {aiCallbacksAvailable ? (
            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div className="min-w-0 space-y-0.5">
                <label htmlFor="missed-call-ai" className="text-sm font-medium">
                  Have the AI call them back instead
                </label>
                <p className="text-xs text-muted-foreground">
                  Your AI phones them from your number and says it&rsquo;s an AI. If the call can&rsquo;t be placed, they get the text.
                </p>
              </div>
              <Switch
                id="missed-call-ai"
                name="aiCallbacks"
                checked={on && aiOn}
                onCheckedChange={setAiOn}
                disabled={pending || !on}
              />
            </div>
          ) : null}

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
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>
                Last 7 days: {stats.sent} sent
                {stats.pending ? `, ${stats.pending} waiting for daytime` : ""}
                {stats.failed ? `, ${stats.failed} failed` : ""}
                {stats.skipped ? `, ${stats.skipped} not sent` : ""}.
              </p>
              {skips.length ? (
                <ul className="space-y-0.5 text-xs" data-testid="missed-call-skips">
                  {skips.map((s) => (
                    <li key={s.reason}>
                      · {s.count} {s.count === 1 ? "caller" : "callers"} {s.label}
                    </li>
                  ))}
                </ul>
              ) : null}
              {noConsent ? (
                <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-900">
                  We only text callers who agreed to texts from you, so {noConsent}{" "}
                  {noConsent === 1 ? "caller" : "callers"} didn&apos;t get one. To reach more people, turn on{" "}
                  <a href="#text-consent" className="font-medium underline underline-offset-2">
                    Ask callers who leave a message if you can text them
                  </a>
                  .
                </p>
              ) : null}
            </div>
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
