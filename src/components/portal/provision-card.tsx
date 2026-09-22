"use client";

import { useActionState, useEffect } from "react";
import { Phone, Rocket, RefreshCw, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { provisionAgentPortalAction } from "@/lib/actions/agent";
import { initialActionState } from "@/lib/actions/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SubmitButton } from "@/components/form/submit-button";
import { TestCallButton } from "@/components/clients/test-call-button";
import { CallMeNow } from "@/components/portal/call-me-now";
import { formatPhone } from "@/lib/format";

/**
 * Self-serve "activate your AI" card for the client portal. Lets a business
 * owner provision (or re-sync) their Retell agent and, when billing allows, a
 * phone number — then test-call it right in the browser.
 */
export function ProvisionCard({
  clientId,
  hasAgent,
  phoneNumber,
  agentName,
  retellReady,
  onTrial = false,
  ownerPhone = null,
}: {
  clientId: string;
  hasAgent: boolean;
  phoneNumber: string | null;
  agentName: string;
  retellReady: boolean;
  /** Approved free trial — full access, shown as a friendly badge. */
  onTrial?: boolean;
  /** The owner's alert phone (E.164), prefilled into "Call my phone". */
  ownerPhone?: string | null;
}) {
  const [state, action, pending] = useActionState(provisionAgentPortalAction, initialActionState);

  useEffect(() => {
    if (state.ok) {
      const data = state.data as { phoneNumber?: string | null; phoneError?: string | null } | undefined;
      if (data?.phoneNumber) {
        toast.success(`Your AI is live on ${formatPhone(data.phoneNumber)}.`);
      } else {
        toast.success("Your AI is ready — try a test call below.");
        if (data?.phoneError) toast.info(data.phoneError);
      }
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your AI receptionist</CardTitle>
        <CardDescription>
          {hasAgent
            ? "Your receptionist is set up. Changes you save publish to it automatically — re-sync only if something looks out of date."
            : "Activate your receptionist so you can hear it and put it to work."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {onTrial ? (
          <p className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="size-3.5" /> Free trial — full access, nothing held back
          </p>
        ) : null}
        {hasAgent ? (
          <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <div>
              {phoneNumber ? (
                <p className="flex items-center gap-1.5">
                  <Phone className="size-4" /> Your number:{" "}
                  <strong className="tabular-nums">{formatPhone(phoneNumber)}</strong>
                </p>
              ) : (
                <p>
                  Ready to talk to in your browser. Its own phone number is on the way — if this
                  still says so tomorrow, press Re-sync below or send us a note from Settings.
                </p>
              )}
            </div>
          </div>
        ) : null}

        {/* Anchor: the setup checklist's "make a test call" step links here.
            Two ways to hear it: in the browser, or on your own phone from the
            AI's real number — the one that proves the line, not just the AI. */}
        {hasAgent ? (
          <div id="test-call" className="scroll-mt-24 space-y-4">
            <div>
              <p className="mb-2 text-sm font-medium">In your browser</p>
              <TestCallButton clientId={clientId} agentName={agentName} />
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">On your phone</p>
              <CallMeNow clientId={clientId} defaultPhone={ownerPhone} hasNumber={Boolean(phoneNumber)} />
            </div>
          </div>
        ) : null}

        {!retellReady ? (
          <p className="text-sm text-amber-600 dark:text-amber-400">
            Activation isn&apos;t available yet — the voice service isn&apos;t connected. Please reach
            out to support (see Settings) and we&apos;ll switch it on.
          </p>
        ) : (
          <form action={action}>
            <input type="hidden" name="clientId" value={clientId} />
            <SubmitButton pending={pending} variant={hasAgent ? "outline" : "default"}>
              {hasAgent ? (
                <>
                  <RefreshCw className="size-4" />
                  Re-sync my receptionist
                </>
              ) : (
                <>
                  <Rocket className="size-4" />
                  Activate my receptionist
                </>
              )}
            </SubmitButton>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
