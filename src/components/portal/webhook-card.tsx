"use client";

import { useActionState, useEffect, useState } from "react";
import { Copy, Eye, EyeOff, RefreshCw, Send, Webhook } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PanelHeader } from "@/components/panel-header";
import {
  rotateWebhookSecretAction,
  saveWebhookAction,
  sendTestWebhookAction,
} from "@/lib/actions/webhooks";
import { initialActionState } from "@/lib/actions/types";
import { OUTBOUND_EVENTS } from "@/lib/webhooks-out";

/**
 * Send my calls, leads and bookings somewhere else.
 *
 * Written for the person who already has a CRM and is being asked to run two
 * systems. The copy never says "webhook" without immediately saying what it is
 * for, and the events are listed by name because the first question anybody
 * asks is "what will it send me".
 */
export function WebhookCard({
  clientId,
  url,
  secret,
  isAdmin,
}: {
  clientId: string;
  url: string | null;
  secret: string | null;
  isAdmin: boolean;
}) {
  const [saveState, save, saving] = useActionState(saveWebhookAction, initialActionState);
  const [testState, test, testing] = useActionState(sendTestWebhookAction, initialActionState);
  const [rotState, rotate, rotating] = useActionState(
    rotateWebhookSecretAction,
    initialActionState,
  );
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    for (const s of [saveState, testState, rotState]) {
      if (s.ok && s.message) toast.success(s.message);
      else if (s.error) toast.error(s.error);
    }
  }, [saveState, testState, rotState]);

  if (!isAdmin) return null;

  return (
    <Card>
      <CardContent className="space-y-5 p-5 sm:p-6">
        <PanelHeader
          icon={Webhook}
          title="Send events to your other tools"
          description="Point this at your CRM, a Zapier or Make webhook, or anything that accepts JSON, and we'll post there the moment something happens — so nobody has to retype a lead."
        />

        <div className="flex flex-wrap gap-1.5">
          {OUTBOUND_EVENTS.map((e) => (
            <code
              key={e}
              className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"
            >
              {e}
            </code>
          ))}
        </div>

        <form action={save} className="space-y-2">
          <input type="hidden" name="clientId" value={clientId} />
          <label className="block text-sm font-medium" htmlFor="webhookUrl">
            Endpoint URL
          </label>
          <Input
            id="webhookUrl"
            name="webhookUrl"
            type="url"
            defaultValue={url ?? ""}
            placeholder="https://hooks.zapier.com/hooks/catch/…"
            autoComplete="off"
            aria-invalid={Boolean(saveState.fieldErrors?.webhookUrl)}
          />
          {saveState.fieldErrors?.webhookUrl ? (
            <p className="text-sm text-destructive">{saveState.fieldErrors.webhookUrl[0]}</p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Leave it empty and press Save to turn this off.
          </p>
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>

        {url && secret ? (
          <div className="space-y-3 border-t pt-5">
            <div>
              <p className="text-sm font-medium">Signing secret</p>
              <p className="text-xs text-muted-foreground">
                Every delivery carries an <code>X-FrontDesk-Signature</code> header built from this.
                Check it on your end so nobody else can post fake bookings into your CRM.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-3 py-2 text-xs">
                {revealed ? secret : "•".repeat(28)}
              </code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setRevealed((v) => !v)}
              >
                {revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                {revealed ? "Hide" : "Show"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(secret)
                    .then(() => toast.success("Signing secret copied."))
                    .catch(() => toast.error("Couldn't copy — show it and copy by hand."));
                }}
              >
                <Copy className="size-3.5" />
                Copy
              </Button>
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <form action={rotate}>
                <input type="hidden" name="clientId" value={clientId} />
                <Button type="submit" variant="ghost" size="sm" disabled={rotating}>
                  <RefreshCw className="size-3.5" />
                  {rotating ? "Rotating…" : "New secret"}
                </Button>
              </form>
              <form action={test}>
                <input type="hidden" name="clientId" value={clientId} />
                <Button type="submit" variant="outline" size="sm" disabled={testing}>
                  <Send className="size-3.5" />
                  {testing ? "Sending…" : "Send test event"}
                </Button>
              </form>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
