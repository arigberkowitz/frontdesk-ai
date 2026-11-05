"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { saveTextingControlsAction } from "@/lib/actions/texting-controls";
import { initialActionState } from "@/lib/actions/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { NativeSelect } from "@/components/form/native-select";
import { SubmitButton } from "@/components/form/submit-button";
import { hourLabel } from "@/lib/texting-policy";

const HOURS = Array.from({ length: 24 }, (_, h) => h);

/** Settings → Phone & AI → Texting controls: the owner's on/off switch and quiet hours. */
export function TextingControlsCard({
  clientId,
  textingEnabled,
  quietStartHour,
  quietEndHour,
  timeZone,
  isOwner,
}: {
  clientId: string;
  textingEnabled: boolean;
  quietStartHour: number;
  quietEndHour: number;
  timeZone: string;
  isOwner: boolean;
}) {
  const [state, action, pending] = useActionState(saveTextingControlsAction, initialActionState);
  const [on, setOn] = useState(textingEnabled);
  useEffect(() => {
    if (state.ok && state.message) toast.success(state.message);
    else if (!state.ok && state.error) toast.error(state.error);
  }, [state]);
  const disabled = pending || !isOwner;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Texting controls</CardTitle>
        <CardDescription>Choose whether and when your AI texts customers automatically.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <input type="hidden" name="clientId" value={clientId} />
          <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
            <div className="min-w-0 space-y-0.5">
              <label htmlFor="texting-enabled" className="text-sm font-medium">
                Automatic texts to customers
              </label>
              <p className="text-xs text-muted-foreground">
                {on
                  ? "On: confirmations, reminders, missed-call and follow-up texts, and the AI's text replies go out."
                  : "Off: nothing is texted automatically. No confirmations, reminders, missed-call or follow-up texts, and the AI won't reply to customers' texts. Messages you send yourself still go out."}
              </p>
            </div>
            <Switch id="texting-enabled" name="textingEnabled" checked={on} onCheckedChange={setOn} disabled={disabled} />
          </div>

          <div className="space-y-2 rounded-lg border p-3">
            <p className="text-sm font-medium">Quiet hours</p>
            <p className="text-xs text-muted-foreground">
              Automatic texts are held during these hours and sent when they end. Messages you send yourself still go out. Times are in {timeZone}.
            </p>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>From</span>
              <NativeSelect name="quietStartHour" defaultValue={quietStartHour} disabled={disabled} className="w-auto" aria-label="Quiet hours start">
                {HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
              </NativeSelect>
              <span>to</span>
              <NativeSelect name="quietEndHour" defaultValue={quietEndHour} disabled={disabled} className="w-auto" aria-label="Quiet hours end">
                {HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
              </NativeSelect>
            </div>
          </div>
          {isOwner ? <SubmitButton pending={pending}>Save texting controls</SubmitButton> : <p className="text-xs text-muted-foreground">Only the account owner can change these.</p>}
        </form>
      </CardContent>
    </Card>
  );
}
