"use client";

import { useActionState, useEffect, useRef } from "react";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PanelHeader } from "@/components/panel-header";
import { setAutoAttachSignupsAction } from "@/lib/actions/signups";
import { initialActionState } from "@/lib/actions/types";

/**
 * Operator-only control: whether every self-serve signup automatically lands
 * on this agency dashboard (default) or spins up its own isolated workspace.
 */
export function SignupsCard({ enabled }: { enabled: boolean }) {
  const [state, action, pending] = useActionState(setAutoAttachSignupsAction, initialActionState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) toast.success(state.message ?? "Saved.");
    else if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <Card>
      <CardContent className="p-5 sm:p-6">
        <PanelHeader
          icon={UserPlus}
          title="New signups"
          description="When on, every business that signs up appears on this dashboard as your client, so you can see and help with everything. When off, signups get their own separate workspace you can't see."
        />
        <form ref={formRef} action={action} className="mt-4">
          <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
          <div className="flex items-center gap-2">
            <Switch
              id="autoAttachSignups"
              checked={enabled}
              disabled={pending}
              onCheckedChange={() => formRef.current?.requestSubmit()}
            />
            <Label htmlFor="autoAttachSignups">
              Add new signups to my dashboard automatically (recommended)
            </Label>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
