"use client";

import { useActionState, useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PanelHeader } from "@/components/panel-header";
import { resyncAllAgentsAction } from "@/lib/actions/resync";
import { initialActionState } from "@/lib/actions/types";

/** Operator-only: push the latest prompt rules + tools to every live agent. */
export function ResyncCard() {
  const [state, action, pending] = useActionState(resyncAllAgentsAction, initialActionState);

  useEffect(() => {
    if (state.ok) toast.success(state.message ?? "Done.");
    else if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <Card>
      <CardContent className="p-5 sm:p-6">
        <PanelHeader
          icon={RefreshCw}
          title="Update all live agents"
          description="Pushes the newest receptionist improvements (prompt rules, booking guards, tools) to every client that's already live — so earlier signups get everything new clients get."
        />
        <form action={action} className="mt-4 flex justify-end">
          <Button type="submit" size="sm" disabled={pending}>
            <RefreshCw className={`size-3.5 ${pending ? "animate-spin" : ""}`} />
            {pending ? "Updating agents…" : "Update all agents now"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
