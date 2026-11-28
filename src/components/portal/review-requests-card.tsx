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
import {
  DEFAULT_REVIEW_DELAY_HOURS,
  REVIEW_DELAY_OPTIONS,
  REVIEW_MIN_DAYS_BETWEEN,
  reviewRequestBody,
} from "@/lib/review-requests";
import { MIN_DAYS_BETWEEN_REVENUE_TEXTS, SEND_END_HOUR, SEND_START_HOUR } from "@/lib/revenue-texts";

const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`;
const delayLabel = (h: number) => (h === 1 ? "1 hour" : h === 24 ? "1 day" : `${h} hours`);
import { WhatsThis } from "@/components/portal/feature-explainer";

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
  businessName = "",
  enabled,
  reviewUrl,
  delayHours = DEFAULT_REVIEW_DELAY_HOURS,
  results = null,
  isAdmin,
}: {
  clientId: string;
  businessName?: string;
  enabled: boolean;
  reviewUrl: string | null;
  /** Hours after the visit ends before the text (setup_flags.reviewDelayHours). */
  delayHours?: number;
  /** Real counts for the last 30 days, or null when nothing was sent. */
  results?: string | null;
  isAdmin: boolean;
}) {
  const [state, action, pending] = useActionState(
    saveReviewRequestSettingsAction,
    initialActionState,
  );
  const [on, setOn] = useState(enabled);
  const [delay, setDelay] = useState(delayHours);
  const [link, setLink] = useState(reviewUrl ?? "");

  useEffect(() => {
    if (state.ok && state.message) toast.success(state.message);
    else if (state.error) toast.error(state.error);
  }, [state]);

  if (!isAdmin) return null;

  return (
    <Card data-testid="review-requests-card">
      <CardContent className="p-5 sm:p-6">
        <PanelHeader
          icon={Star}
          title="Ask for reviews"
          description="A couple of hours after a visit, we text the customer a thank-you and your review link. Reviews are how people decide who to call, and the best time to ask is while they still remember you."
        />
        <WhatsThis feature="reviewRequests" className="sm:ml-12" />
        {results ? (
          <p className="mt-3 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 sm:ml-12" data-testid="review-results">
            {results}
          </p>
        ) : null}

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
              value={link}
              onChange={(e) => setLink(e.target.value)}
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

          <div className="space-y-2">
            <label className="block text-sm font-medium" htmlFor="review-delay">
              Send it this long after the appointment ends
            </label>
            <select
              id="review-delay"
              name="delayHours"
              value={delay}
              onChange={(e) => setDelay(Number(e.target.value))}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              {REVIEW_DELAY_OPTIONS.map((h) => (
                <option key={h} value={h}>
                  {delayLabel(h)}
                  {h === DEFAULT_REVIEW_DELAY_HOURS ? " (suggested)" : ""}
                </option>
              ))}
            </select>
          </div>

          <figure>
            <figcaption className="mb-1.5 text-xs text-muted-foreground">Preview</figcaption>
            <blockquote className="max-w-md rounded-2xl rounded-bl-sm bg-muted px-3.5 py-2.5 text-sm leading-relaxed" data-testid="review-preview">
              {reviewRequestBody({
                businessName: businessName || "Your business",
                customerName: "Sam",
                reviewUrl: link.trim() || "[your review link]",
              })}
            </blockquote>
          </figure>

          {/* Say the limits out loud. An owner's real question about anything
              that texts their customers is "how often, and can it embarrass
              me?" — answering it here is cheaper than answering it later. */}
          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>· Sent {delayLabel(delay)} after the appointment ends, never before, between {hourLabel(SEND_START_HOUR)} and {hourLabel(SEND_END_HOUR)} your time.</li>
            <li>· One per visit, and never twice to the same person within {REVIEW_MIN_DAYS_BETWEEN} days.</li>
            <li>· Only customers who said yes to texts; never to someone who replied STOP, a number you blocked, or a caller marked as spam. At most one follow-up text per person every {MIN_DAYS_BETWEEN_REVENUE_TEXTS} days.</li>
            <li>· Everyone gets the same ask. We never check whether they were happy first; Google doesn&rsquo;t allow that.</li>
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
