"use client";

import { useActionState, useEffect, useState } from "react";
import { MessageSquareText } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { PanelHeader } from "@/components/panel-header";
import { WhatsThis } from "@/components/portal/feature-explainer";
import { saveQuoteFollowupAction } from "@/lib/actions/quote-followup";
import { initialActionState } from "@/lib/actions/types";
import { formatCurrencyCents } from "@/lib/format";
import { DEFAULT_TEMPLATES, MAX_TEMPLATE_CHARS, renderFollowup } from "@/lib/revenue/quote-followup";

export interface QuoteFollowupStatsView {
  days: number;
  textsSent: number;
  peopleTexted: number;
  replies: number;
  bookingsAfter: number;
  bookedValueCents: number | null;
  bookingsWithoutPrice: number;
  askedRecently: number;
  askedAndAgreedToTexts: number;
}

/**
 * Settings → Follow-ups (and the operator's client page): text callers who
 * asked for a quote or price and never booked. Off by default.
 */
export function QuoteFollowupCard({
  clientId,
  businessName,
  enabled,
  step1Template,
  step2Template,
  blockedReason,
  stats,
  isAdmin,
}: {
  clientId: string;
  businessName: string;
  enabled: boolean;
  step1Template?: string | null;
  step2Template?: string | null;
  /** Plain-words reason nothing can send yet (no texting number, not approved…), or null. */
  blockedReason?: string | null;
  stats: QuoteFollowupStatsView | null;
  isAdmin: boolean;
}) {
  const [state, action, pending] = useActionState(saveQuoteFollowupAction, initialActionState);
  const [on, setOn] = useState(enabled);
  const [t1, setT1] = useState(step1Template ?? "");
  const [t2, setT2] = useState(step2Template ?? "");

  useEffect(() => {
    if (state.ok && state.message) toast.success(state.message);
    else if (state.error) toast.error(state.error);
  }, [state]);

  if (!isAdmin) return null;

  const preview = (step: 1 | 2, language: "en" | "es" = "en") =>
    renderFollowup({
      step,
      businessName,
      customerName: "Alex",
      language,
      template: step === 1 ? t1 : t2,
    });

  return (
    <Card id="quote-followup" className="scroll-mt-24">
      <CardContent className="p-5 sm:p-6">
        <PanelHeader
          icon={MessageSquareText}
          title="Follow up on price questions"
          description="When someone calls to ask for a quote, price or estimate and doesn't book, we text them a day later and again a week after the call."
        />
        <WhatsThis
          className="sm:ml-12"
          explainer={{
            what: "A caller who asked what something costs and didn't book gets one friendly text the next day, and one more a week after the call. It stops as soon as they book, reply, call back or text STOP.",
            example: "Someone asks about a water heater quote on Monday. Tuesday they get a text from your business asking if they still need it.",
          }}
        />

        <form action={action} className="mt-5 space-y-4">
          <input type="hidden" name="clientId" value={clientId} />

          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <label htmlFor={`quote-followup-enabled-${clientId}`} className="text-sm font-medium">
              Text callers who asked for a price and didn&rsquo;t book
            </label>
            <Switch
              id={`quote-followup-enabled-${clientId}`}
              name="enabled"
              checked={on}
              onCheckedChange={setOn}
              disabled={pending}
            />
          </div>

          {on && blockedReason ? (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-900">
              {blockedReason}
            </p>
          ) : null}

          <div className="space-y-2">
            <p className="text-sm font-medium">What they get</p>
            <div className="space-y-2 rounded-lg bg-muted/50 p-3 text-xs">
              <p>
                <span className="font-medium text-foreground">Text 1, about a day after the call: </span>
                <span className="text-muted-foreground">{preview(1)}</span>
              </p>
              <p>
                <span className="font-medium text-foreground">Text 2, about a week after the call: </span>
                <span className="text-muted-foreground">{preview(2)}</span>
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              Callers who spoke Spanish get the same two texts in Spanish.
            </p>
          </div>

          <details className="group rounded-lg border">
            <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
              Edit the messages
              <span className="text-xs font-normal text-muted-foreground underline underline-offset-2">
                Optional
              </span>
            </summary>
            <div className="space-y-4 border-t p-3">
              <div className="space-y-1.5">
                <label htmlFor={`quote-t1-${clientId}`} className="text-xs font-medium">
                  Text 1
                </label>
                <Textarea
                  id={`quote-t1-${clientId}`}
                  name="step1Template"
                  value={t1}
                  onChange={(e) => setT1(e.target.value)}
                  placeholder={DEFAULT_TEMPLATES.en[1]}
                  maxLength={MAX_TEMPLATE_CHARS}
                  rows={3}
                  disabled={pending}
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor={`quote-t2-${clientId}`} className="text-xs font-medium">
                  Text 2
                </label>
                <Textarea
                  id={`quote-t2-${clientId}`}
                  name="step2Template"
                  value={t2}
                  onChange={(e) => setT2(e.target.value)}
                  placeholder={DEFAULT_TEMPLATES.en[2]}
                  maxLength={MAX_TEMPLATE_CHARS}
                  rows={3}
                  disabled={pending}
                />
              </div>
              <ul className="space-y-1 text-xs text-muted-foreground">
                <li>
                  · Use <code>{"{name}"}</code> for their first name and <code>{"{business}"}</code> for
                  your business name. Leave a box empty to use the standard text.
                </li>
                <li>· Only mention a price or a deal if it&rsquo;s real. Texts with links are not allowed.</li>
                <li>· Your business name and &ldquo;Reply STOP to opt out.&rdquo; are always in the text.</li>
                <li>· These edits are for English. Spanish callers get the standard Spanish text.</li>
              </ul>
              {t1 || t2 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setT1("");
                    setT2("");
                  }}
                >
                  Use the standard texts
                </Button>
              ) : null}
            </div>
          </details>

          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>· Only to callers who agreed to texts from you, and never after STOP.</li>
            <li>· Never to blocked or spam numbers.</li>
            <li>
              · Never to anyone who booked, texted back or called back. Text 2 only goes to people who
              got text 1.
            </li>
            <li>· Sent 9am to 7pm in your time zone, from your business&rsquo;s texting number.</li>
            <li>· Text 1 goes out about a day after the call, text 2 about a week after it.</li>
          </ul>

          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>

        <Results stats={stats} enabled={enabled} />
      </CardContent>
    </Card>
  );
}

function Results({ stats, enabled }: { stats: QuoteFollowupStatsView | null; enabled: boolean }) {
  if (!stats) return null;
  const none = stats.textsSent === 0;
  return (
    <div className="mt-6 border-t pt-4">
      <p className="text-sm font-medium">Last {stats.days} days</p>
      {none ? (
        <p className="mt-1 text-sm text-muted-foreground">
          No follow-up texts have gone out yet.
          {stats.askedRecently > 0
            ? ` ${stats.askedRecently} ${stats.askedRecently === 1 ? "caller" : "callers"} asked about a price recently, and ${stats.askedAndAgreedToTexts} of them agreed to texts. We only text people who agreed.`
            : enabled
              ? " Nobody has asked about a price recently."
              : ""}
        </p>
      ) : (
        <>
          <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Texts sent" value={stats.textsSent} />
            <Stat label="People texted" value={stats.peopleTexted} />
            <Stat label="Texted back" value={stats.replies} />
            <Stat label="Booked after our text" value={stats.bookingsAfter} />
          </dl>
          {stats.bookedValueCents !== null ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Listed price of those bookings: {formatCurrencyCents(stats.bookedValueCents)}
              {stats.bookingsWithoutPrice > 0
                ? `, not counting ${stats.bookingsWithoutPrice} with no price listed`
                : ""}
              .
            </p>
          ) : null}
          <p className="mt-2 text-xs text-muted-foreground">
            &ldquo;Booked after our text&rdquo; counts people who booked within 14 days after our first
            text, and not before it. Some of them may have booked anyway.
          </p>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border p-3">
      <dd className="font-heading text-2xl font-semibold tabular-nums">{value}</dd>
      <dt className="text-xs text-muted-foreground">{label}</dt>
    </div>
  );
}
