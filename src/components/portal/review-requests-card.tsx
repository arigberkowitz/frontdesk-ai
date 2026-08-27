"use client";

import { useActionState, useEffect, useState } from "react";
import { Star } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { PanelHeader } from "@/components/panel-header";
import { saveReviewRequestSettingsAction } from "@/lib/actions/growth-settings";
import { initialActionState } from "@/lib/actions/types";
import { REVIEW_DELAY_HOURS, REVIEW_MIN_DAYS_BETWEEN } from "@/lib/review-requests";

/**
 * Ask happy customers to say so where it counts.
 *
 * The switch and the link are one form because they are one decision: a
 * business that hasn't chosen where reviews go has not agreed to ask for them.
 * The rules are printed rather than hidden, because the first thing an owner
 * wants to know about anything that texts their customers automatically is
 * exactly how often it will do that.
 */
export function ReviewRequestsCard({
  clientId,
  enabled,
  reviewUrl,
  isAdmin,
}: {
  clientId: string;
  enabled: boolean;
  reviewUrl: string | null;
  isAdmin: boolean;
}) {
  const [state, action, pending] = useActionState(
    saveReviewRequestSettingsAction,
    initialActionState,
  );
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
          icon={Star}
          title="Ask for reviews"
          description="A few hours after a visit, we text the customer a thank-you and your review link. Reviews are how people decide who to call, and the best time to ask is while they still remember you."
        />

        <form action={action} className="mt-5 space-y-4">
          <input type="hidden" name="clientId" value={clientId} />

          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <label htmlFor="review-enabled" className="text-sm font-medium">
              Send review requests
            </label>
            <Switch
              id="review-enabled"
              name="enabled"
              checked={on}
              onCheckedChange={setOn}
              disabled={pending}
            />
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium" htmlFor="reviewUrl">
              Your review link
            </label>
            <Input
              id="reviewUrl"
              name="reviewUrl"
              type="url"
              defaultValue={reviewUrl ?? ""}
              placeholder="https://g.page/r/…/review"
              autoComplete="off"
              aria-invalid={Boolean(state.fieldErrors?.reviewUrl)}
            />
            {state.fieldErrors?.reviewUrl ? (
              <p className="text-sm text-destructive">{state.fieldErrors.reviewUrl[0]}</p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              On Google, search your business, click Ask for reviews, and copy the link it gives
              you.
            </p>
          </div>

          {/* Say the limits out loud. An owner's real question about anything
              that texts their customers is "how often, and can it embarrass
              me?" — answering it here is cheaper than answering it later. */}
          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>· Sent {REVIEW_DELAY_HOURS} hours after the appointment ends, never before.</li>
            <li>· One per visit, and never twice to the same person within {REVIEW_MIN_DAYS_BETWEEN} days.</li>
            <li>· Daytime only, and never to someone who replied STOP.</li>
            <li>· Cancellations and no-shows are never asked.</li>
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
