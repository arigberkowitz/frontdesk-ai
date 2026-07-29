"use client";

import { useActionState, useEffect } from "react";
import { FolderInput } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { adoptWorkspaceAction } from "@/lib/actions/platform";
import { initialActionState } from "@/lib/actions/types";

/** "Adopt into my agency" — pulls an isolated signup onto the operator dashboard. */
export function AdoptWorkspace({ orgId, name }: { orgId: string; name: string }) {
  const [state, action, pending] = useActionState(adoptWorkspaceAction, initialActionState);

  useEffect(() => {
    if (state.ok) toast.success(state.message ?? "Adopted.");
    else if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <form action={action}>
      <input type="hidden" name="orgId" value={orgId} />
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={pending}
        title={`Move ${name} onto your Clients list`}
      >
        <FolderInput className="size-3.5" />
        {pending ? "Adopting…" : "Adopt into my agency"}
      </Button>
    </form>
  );
}
