"use client";

import { useActionState, useEffect, useState } from "react";
import { HeartHandshake } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { PanelHeader } from "@/components/panel-header";
import { saveWinbackSettingsAction } from "@/lib/actions/revenue-settings";
import { initialActionState } from "@/lib/actions/types";
import { MAX_TEMPLATE_CHARS, MIN_DAYS_BETWEEN_REVENUE_TEXTS, SEND_END_HOUR, SEND_START_HOUR } from "@/lib/revenue-texts";
import {
  DEFAULT_WINBACK_TEMPLATE,
  MAX_WINBACK_MONTHS,
  MIN_WINBACK_MONTHS,
  WINBACK_PRESETS,
  clampMonths,
  monthsLabel,
  winbackBody,
} from "@/lib/winback";
import { cn } from "@/lib/utils";

const hour = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`;

/**
 * Win-back settings (Pro). The switch, how long "a while" is, the wording,
 * and a live preview of the exact text — the preview runs the same function
 * the cron sends with, so what the owner reads is what the customer gets.
 */
export function WinbackCard({
  clientId,
  businessName,
  enabled,
  months: initialMonths,
  template: initialTemplate,
  results,
  isAdmin,
}: {
  clientId: string;
  businessName: string;
  enabled: boolean;
  months: number;
  template: string;
  /** Real counts for the last 30 days, or null when nothing has been sent. */
  results: string | null;
  isAdmin: boolean;
}) {
  const [state, action, pending] = useActionState(saveWinbackSettingsAction, initialActionState);
  const [on, setOn] = useState(enabled);
  const [months, setMonths] = useState(initialMonths);
  const [template, setTemplate] = useState(initialTemplate);

  useEffect(() => {
    if (state.ok && state.message) toast.success(state.message);
    else if (state.error) toast.error(state.error);
  }, [state]);

  if (!isAdmin) return null;
  const preview = winbackBody(
    { business: businessName, firstName: "Sam", serviceName: null },
    { template },
  );
  const custom = !WINBACK_PRESETS.some((p) => p.months === months);

  return (
    <Card data-testid="winback-card">
      <CardContent className="p-5 sm:p-6">
        <PanelHeader
          icon={HeartHandshake}
          title="Win-back texts"
          description="Once a month, past customers who haven't been back in a while get one text inviting them to book."
        />
        {results ? (
          <p className="mt-3 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 sm:ml-12" data-testid="winback-results">
            {results}
          </p>
        ) : null}

        <form action={action} className="mt-5 space-y-5">
          <input type="hidden" name="clientId" value={clientId} />
          <input type="hidden" name="months" value={months} />

          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <label htmlFor="winback-enabled" className="text-sm font-medium">
              Send win-back texts
            </label>
            <Switch id="winback-enabled" name="enabled" checked={on} onCheckedChange={setOn} disabled={pending} />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Text customers who haven&rsquo;t been back in</legend>
            <div className="flex flex-wrap gap-2">
              {WINBACK_PRESETS.map((p) => (
                <button
                  key={p.months}
                  type="button"
                  onClick={() => setMonths(p.months)}
                  aria-pressed={months === p.months}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-sm",
                    months === p.months ? "border-indigo-500 bg-indigo-500/10 text-indigo-700" : "hover:bg-muted",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Or
              <input
                type="number"
                min={MIN_WINBACK_MONTHS}
                max={MAX_WINBACK_MONTHS}
                value={months}
                onChange={(e) => setMonths(clampMonths(e.target.value))}
                className={cn("h-8 w-16 rounded-md border bg-background px-2 text-foreground", custom && "border-indigo-500")}
                aria-label="Months"
              />
              months
            </label>
          </fieldset>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor="winback-template" className="text-sm font-medium">
                The text
              </label>
              <Button type="button" variant="outline" size="sm" onClick={() => setTemplate(DEFAULT_WINBACK_TEMPLATE)}>
                Fill in for me
              </Button>
            </div>
            <Textarea
              id="winback-template"
              name="template"
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              maxLength={MAX_TEMPLATE_CHARS}
              rows={3}
              placeholder={DEFAULT_WINBACK_TEMPLATE}
            />
            {state.fieldErrors?.template ? (
              <p className="text-sm text-destructive">{state.fieldErrors.template[0]}</p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Leave it empty to use the suggested text. You can use {"{first_name}"}, {"{business}"} and {"{service}"}.
              Spanish-speaking customers get the Spanish version. Your business name and &ldquo;Reply STOP to opt
              out.&rdquo; are always included.
            </p>
          </div>

          <figure>
            <figcaption className="mb-1.5 text-xs text-muted-foreground">Preview</figcaption>
            <blockquote className="max-w-md rounded-2xl rounded-bl-sm bg-muted px-3.5 py-2.5 text-sm leading-relaxed" data-testid="winback-preview">
              {preview}
            </blockquote>
          </figure>

          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>· Only past customers who booked with you and said yes to texts. Never a bought list.</li>
            <li>· One text per customer every {monthsLabel(months)}, and never to someone who already has a visit booked.</li>
            <li>· Sent between {hour(SEND_START_HOUR)} and {hour(SEND_END_HOUR)} your time, and at most one of these texts per person every {MIN_DAYS_BETWEEN_REVENUE_TEXTS} days across all follow-ups.</li>
            <li>· Never to someone who replied STOP, a number you blocked, or a caller marked as spam.</li>
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
