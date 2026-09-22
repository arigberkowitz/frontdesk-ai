"use client";

import { useActionState, useEffect, useState } from "react";
import { Loader2, PhoneOutgoing } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { callMeNowAction } from "@/lib/actions/call-me";
import { initialActionState } from "@/lib/actions/types";
import { formatPhone } from "@/lib/format";

/**
 * "Call my phone": the receptionist rings the owner from the business's own
 * AI number. Sits next to the browser test call — the browser proves the AI
 * can talk, this proves the line works, and it's the demo you hand someone
 * your phone for.
 *
 * The number defaults to the alert phone from Settings, so for most owners
 * it's one press. Anyone can retype it: the person pressing the button is
 * the person who gets rung, and the server caps it at a few per ten minutes.
 */
export function CallMeNow({
  clientId,
  defaultPhone,
  hasNumber,
}: {
  clientId: string;
  /** E.164 or null — the owner's alert phone, if they've set one. */
  defaultPhone: string | null;
  /** Whether the AI has a phone number to call from. */
  hasNumber: boolean;
}) {
  const [state, action, pending] = useActionState(callMeNowAction, initialActionState);
  const [phone, setPhone] = useState(defaultPhone ? formatPhone(defaultPhone) : "");
  // "Ringing…" is cosmetic — fifteen seconds of "it's on its way" so a second
  // press isn't the reflex while the carrier connects. Derived from the last
  // successful result rather than set directly, so it expires per result.
  const [expired, setExpired] = useState<typeof state | null>(null);
  const ringing = Boolean(state.ok) && expired !== state;

  useEffect(() => {
    if (state.ok && state.message) {
      toast.success(state.message);
      const t = setTimeout(() => setExpired(state), 15_000);
      return () => clearTimeout(t);
    }
    if (state.error) toast.error(state.error);
  }, [state]);

  const phoneError = state.fieldErrors?.phone?.[0];

  if (!hasNumber) {
    return (
      <p className="text-sm text-muted-foreground">
        Once your AI has its own phone number, you&apos;ll be able to have it ring your cell from
        here so you can hear it on a real call.
      </p>
    );
  }

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="clientId" value={clientId} />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <label htmlFor="call-me-phone" className="sr-only">
            Your phone number
          </label>
          <Input
            id="call-me-phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="(415) 555-0100"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            aria-invalid={phoneError ? true : undefined}
            disabled={pending || ringing}
            required
          />
          {phoneError ? (
            <p className="mt-1 text-xs text-destructive">{phoneError}</p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              Your AI calls this number from its own line — pick up and talk to it like a customer would.
            </p>
          )}
        </div>
        <Button type="submit" disabled={pending || ringing || !phone.trim()} className="sm:shrink-0">
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <PhoneOutgoing className="size-4" />
          )}
          {pending ? "Dialing…" : ringing ? "Ringing your phone…" : "Call my phone"}
        </Button>
      </div>
    </form>
  );
}
