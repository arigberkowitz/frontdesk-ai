"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { unlockEditingAction } from "@/lib/actions/edit-lock";
import { initialActionState } from "@/lib/actions/types";

/**
 * Shown to staff on the AI-configuration pages. If the admin set an edit code,
 * entering it unlocks editing for 12 hours; otherwise it explains who can edit.
 * (Server actions enforce the same rule — this is the friendly half.)
 */
export function EditLockBanner({ clientId, hasCode }: { clientId: string; hasCode: boolean }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(unlockEditingAction, initialActionState);

  useEffect(() => {
    if (state.ok) {
      toast.success(state.message ?? "Unlocked.");
      router.refresh();
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Card className="border-amber-500/40 bg-amber-500/5">
      <CardContent className="flex flex-wrap items-center gap-3 p-4">
        <Lock className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium">Editing is locked</p>
          <p className="text-muted-foreground">
            {hasCode
              ? "Changes here update the live phone agent. Enter the edit code from your admin to unlock for 12 hours."
              : "Changes here update the live phone agent — only your admin can make them."}
          </p>
        </div>
        {hasCode ? (
          <form action={action} className="flex items-center gap-2">
            <input type="hidden" name="clientId" value={clientId} />
            <Input
              name="code"
              type="password"
              placeholder="Edit code"
              aria-label="Edit code"
              className="w-32"
              disabled={pending}
            />
            <Button type="submit" size="sm" variant="outline" disabled={pending}>
              Unlock
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
