"use client";

import { useActionState, useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { PanelHeader } from "@/components/panel-header";
import { saveTextConsentAsksAction } from "@/lib/actions/text-consent-asks";
import { initialActionState } from "@/lib/actions/types";
import { FOLLOWUP_CONSENT_QUESTION, MESSAGE_CONSENT_QUESTION } from "@/lib/text-consent-asks";

/**
 * Settings → Follow-ups: who can be texted, and the two optional questions
 * the AI can ask to grow that list. Both off by default.
 */
export function TextConsentCard({
  clientId,
  followup,
  message,
  counts,
  isAdmin,
}: {
  clientId: string;
  followup: boolean;
  message: boolean;
  counts: { booking: number; followup: number; textBack: number } | null;
  isAdmin: boolean;
}) {
  const [state, action, pending] = useActionState(saveTextConsentAsksAction, initialActionState);
  const [f, setF] = useState(followup);
  const [m, setM] = useState(message);

  useEffect(() => {
    if (state.ok && state.message) toast.success(state.message);
    else if (state.error) toast.error(state.error);
  }, [state]);

  const n = (v: number | undefined) => (v === undefined ? "—" : v.toLocaleString());

  return (
    <Card id="text-consent" className="scroll-mt-24">
      <CardContent className="p-5 sm:p-6">
        <PanelHeader
          icon={ShieldCheck}
          title="Ask callers about texts"
          description="We only text people who said yes, and only about what they said yes to. A yes to booking texts doesn't cover win-back, review or recall texts. Those need their own yes."
        />

        {counts ? (
          <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
            <div className="rounded-lg border p-3">
              <dt className="text-xs text-muted-foreground">Agreed to booking texts</dt>
              <dd className="text-lg font-semibold tabular-nums">{n(counts.booking)}</dd>
            </div>
            <div className="rounded-lg border p-3">
              <dt className="text-xs text-muted-foreground">Can get a missed-call text-back</dt>
              <dd className="text-lg font-semibold tabular-nums">{n(counts.textBack)}</dd>
            </div>
            <div className="rounded-lg border p-3">
              <dt className="text-xs text-muted-foreground">Agreed to follow-up texts (win-back, reviews, recall)</dt>
              <dd className="text-lg font-semibold tabular-nums">{n(counts.followup)}</dd>
            </div>
          </dl>
        ) : null}

        <form action={action} className="mt-5 space-y-4">
          <input type="hidden" name="clientId" value={clientId} />

          <div className="rounded-lg border p-3">
            <div className="flex items-center justify-between gap-4">
              <label htmlFor={`consent-followup-${clientId}`} className="text-sm font-medium">
                Ask callers who book if they&apos;d like follow-up texts
              </label>
              <Switch
                id={`consent-followup-${clientId}`}
                name="followup"
                checked={f}
                onCheckedChange={setF}
                disabled={pending || !isAdmin}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Needed for win-back, review request and recall texts. After a caller agrees to booking
              texts, your AI asks, as a separate optional question:
            </p>
            <blockquote className="mt-2 rounded-lg bg-muted/60 px-3 py-2 text-sm italic">
              &ldquo;{FOLLOWUP_CONSENT_QUESTION}&rdquo;
            </blockquote>
          </div>

          <div className="rounded-lg border p-3">
            <div className="flex items-center justify-between gap-4">
              <label htmlFor={`consent-message-${clientId}`} className="text-sm font-medium">
                Ask callers who leave a message if you can text them
              </label>
              <Switch
                id={`consent-message-${clientId}`}
                name="message"
                checked={m}
                onCheckedChange={setM}
                disabled={pending || !isAdmin}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Lets you text them about their message, and lets a missed-call text-back reach them if a
              later call drops. Your AI asks:
            </p>
            <blockquote className="mt-2 rounded-lg bg-muted/60 px-3 py-2 text-sm italic">
              &ldquo;{MESSAGE_CONSENT_QUESTION}&rdquo;
            </blockquote>
          </div>

          <p className="text-xs text-muted-foreground">
            Only a clear yes counts, and the AI asks once. Spanish callers hear the same questions in
            Spanish. Saving updates your live receptionist right away.
          </p>

          {isAdmin ? (
            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Only your account admin can change this.</p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
