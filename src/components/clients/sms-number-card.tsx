"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { setClientSmsNumberAction } from "@/lib/actions/sms-number";
import { initialActionState } from "@/lib/actions/types";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/form/field";
import { SubmitButton } from "@/components/form/submit-button";

/**
 * Operator-only: give a business its own texting number. The number must
 * already be bought in the platform's Twilio account; nothing is purchased here.
 */
export function SmsNumberCard({
  clientId,
  smsNumber,
}: {
  clientId: string;
  smsNumber: string | null;
}) {
  const [state, action, pending] = useActionState(setClientSmsNumberAction, initialActionState);

  useEffect(() => {
    if (state.ok && state.message) toast.success(state.message);
    else if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Texting number</CardTitle>
        <CardDescription>
          {smsNumber
            ? "This business texts from its own number. Replies and STOP to it go straight to this business."
            : "Using the shared number. Replies are matched to whichever business last texted the customer."}{" "}
          Buy the number in Twilio first (and add it to the A2P campaign), then paste it here. Leave
          empty to go back to the shared number.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex items-end gap-3">
          <input type="hidden" name="clientId" value={clientId} />
          <Field label="Own texting number" className="flex-1" error={state.fieldErrors?.smsNumber}>
            <Input
              name="smsNumber"
              inputMode="tel"
              defaultValue={smsNumber ?? ""}
              placeholder="+14155550123"
            />
          </Field>
          <SubmitButton pending={pending} variant="outline">
            Save number
          </SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
