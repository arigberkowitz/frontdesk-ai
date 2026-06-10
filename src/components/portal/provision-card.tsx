"use client";

import { useActionState, useEffect } from "react";
import { Phone, Rocket, RefreshCw, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { provisionAgentPortalAction } from "@/lib/actions/agent";
import { initialActionState } from "@/lib/actions/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SubmitButton } from "@/components/form/submit-button";
import { TestCallButton } from "@/components/clients/test-call-button";
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
}: {
  clientId: string;
  hasAgent: boolean;
  phoneNumber: string | null;
  agentName: string;
  retellReady: boolean;
}) {
  const [state, action, pending] = useActionState(provisionAgentPortalAction, initialActionState);

  useEffect(() => {
    if (state.ok) {
      const num = (state.data as { phoneNumber?: string | null } | undefined)?.phoneNumber;
      toast.success(
        num
          ? `Your AI is live on ${formatPhone(num)}.`
          : "Your AI is ready — try a test call below.",
      );
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
            ? "Your receptionist is set up. Test it in your browser, and re-sync after you change anything below."
            : "Activate your receptionist so you can hear it and put it to work."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasAgent ? (
          <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
            <div>
              {phoneNumber ? (
                <p className="flex items-center gap-1.5">
                  <Phone className="size-4" /> Your number:{" "}
                  <strong className="tabular-nums">{formatPhone(phoneNumber)}</strong>
                </p>
              ) : (
                <p>
                  Ready to talk to in your browser. A dedicated phone number is added once billing
                  is set up.
                </p>
              )}
            </div>
          </div>
        ) : null}

        {hasAgent ? <TestCallButton clientId={clientId} agentName={agentName} /> : null}

        {!retellReady ? (
          <p className="text-sm text-amber-600">
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
