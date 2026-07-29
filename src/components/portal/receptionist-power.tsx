"use client";

import { useActionState, useEffect } from "react";
import { Power } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PanelHeader } from "@/components/panel-header";
import { setReceptionistPowerAction } from "@/lib/actions/receptionist";
import { initialActionState } from "@/lib/actions/types";

/**
 * The big switch. Admin-only: pause the entire receptionist (message-only
 * answering, no booking/FAQ/texts) or bring it back exactly as it was.
 */
export function ReceptionistPower({
  clientId,
  status,
  isAdmin,
}: {
  clientId: string;
  status: string;
  isAdmin: boolean;
}) {
  const [state, action, pending] = useActionState(setReceptionistPowerAction, initialActionState);

  useEffect(() => {
    if (state.ok) toast.success(state.message ?? "Done.");
    else if (state.error) toast.error(state.error);
  }, [state]);

  if (!isAdmin || status === "draft") return null;
  const paused = status === "paused";

  return (
    <Card className={paused ? "border-amber-500/40 bg-amber-500/5" : undefined}>
      <CardContent className="p-5 sm:p-6">
        <PanelHeader
          icon={Power}
          title={paused ? "Receptionist is OFF" : "Receptionist is on"}
          description={
            paused
              ? "Callers hear a short message and can leave their name and number — no booking, no answers, no texts. Turn it back on anytime and everything comes right back."
              : "Answering, booking, and alerting normally. Turning it off keeps your number answered with a brief take-a-message greeting only."
          }
        />
        <form action={action} className="mt-4 flex justify-end">
          <input type="hidden" name="clientId" value={clientId} />
          <input type="hidden" name="power" value={paused ? "on" : "off"} />
          <Button
            type="submit"
            size="sm"
            variant={paused ? "default" : "outline"}
            disabled={pending}
          >
            <Power className="size-3.5" />
            {pending
              ? paused
                ? "Turning on…"
                : "Turning off…"
              : paused
                ? "Turn receptionist back on"
                : "Turn receptionist off"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
