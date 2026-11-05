"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setEmergencyAction, setTripFeeAction } from "@/lib/actions/trades";
import { initialActionState, type ActionState } from "@/lib/actions/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatPhone } from "@/lib/format";

function useToastResult(state: ActionState) {
  const router = useRouter();
  useEffect(() => {
    if (state.ok) {
      toast.success(state.message ?? "Saved.");
      router.refresh();
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Settings → Phone & AI: what happens when a caller has an emergency. */
export function EmergencyCard({
  clientId,
  transfer247,
  onCallNumber,
  escalationNumber,
  canEdit = true,
}: {
  clientId: string;
  transfer247: boolean;
  onCallNumber?: string | null;
  escalationNumber?: string | null;
  canEdit?: boolean;
}) {
  const [state, action, pending] = useActionState(setEmergencyAction, initialActionState);
  useToastResult(state);
  const err = state.fieldErrors?.onCallNumber?.[0];
  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle>Emergencies</CardTitle>
        <CardDescription>
          Burst pipe, no heat, gas smell, no power. Your AI always tells callers in danger to call
          911. Choose what happens next.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <input type="hidden" name="clientId" value={clientId} />
          <div className="flex items-start gap-3">
            <Switch
              id="transfer247"
              name="transfer247"
              defaultChecked={transfer247}
              disabled={!canEdit}
              className="mt-0.5"
            />
            <Label htmlFor="transfer247" className="block font-normal">
              <span className="block text-sm font-medium">Put emergencies straight through, 24/7</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                On: the AI connects emergency callers to your on-call number at any hour, even when
                you&apos;re closed. Off: it takes an urgent message (with the address) and texts
                and emails you immediately.
              </span>
            </Label>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="onCallNumber">On-call number</Label>
            <Input
              id="onCallNumber"
              name="onCallNumber"
              type="tel"
              autoComplete="off"
              defaultValue={onCallNumber ? formatPhone(onCallNumber) : ""}
              placeholder={escalationNumber ? formatPhone(escalationNumber) : "(555) 010-1234"}
              disabled={!canEdit}
              aria-invalid={Boolean(err)}
            />
            <p className="text-xs text-muted-foreground">
              {escalationNumber
                ? `Leave empty to use your transfer number, ${formatPhone(escalationNumber)}. Urgent message alerts are also texted here.`
                : "Whoever is on call tonight. Urgent message alerts are also texted here."}
            </p>
            {err ? <p className="text-xs text-destructive">{err}</p> : null}
          </div>
          <Button type="submit" size="sm" disabled={pending || !canEdit}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/** Services page: the flat trip / service-call fee. */
export function TripFeeCard({
  clientId,
  tripFeeCents,
}: {
  clientId: string;
  tripFeeCents: number | null;
}) {
  const [state, action, pending] = useActionState(setTripFeeAction, initialActionState);
  useToastResult(state);
  const err = state.fieldErrors?.tripFeeDollars?.[0];
  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle>Trip fee</CardTitle>
        <CardDescription>
          A flat service-call fee for coming out. Your AI mentions it when it books a visit or
          when someone asks what it costs. Leave empty if you don&apos;t charge one.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="clientId" value={clientId} />
          <div className="space-y-1.5">
            <Label htmlFor="tripFeeDollars">Trip fee ($)</Label>
            <Input
              id="tripFeeDollars"
              name="tripFeeDollars"
              type="number"
              min={0}
              step="0.01"
              className="w-36"
              defaultValue={tripFeeCents != null ? tripFeeCents / 100 : ""}
              placeholder="89"
              aria-invalid={Boolean(err)}
            />
          </div>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
          {err ? <p className="w-full text-xs text-destructive">{err}</p> : null}
        </form>
      </CardContent>
    </Card>
  );
}
