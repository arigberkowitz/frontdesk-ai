"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { setLeadStatusAction } from "@/lib/actions/leads";
import { initialActionState } from "@/lib/actions/types";
import { NativeSelect } from "@/components/form/native-select";

const STATUSES = ["new", "contacted", "won", "lost"] as const;

/** Inline follow-up status for a captured message; auto-saves on change. Used by
 *  both the operator client view and the client portal. */
export function LeadStatusControl({
  leadId,
  clientId,
  status,
}: {
  leadId: string;
  clientId: string;
  status: string;
}) {
  const [state, action, pending] = useActionState(setLeadStatusAction, initialActionState);
  useEffect(() => {
    if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <form action={action} className="shrink-0">
      <input type="hidden" name="leadId" value={leadId} />
      <input type="hidden" name="clientId" value={clientId} />
      <NativeSelect
        name="status"
        defaultValue={status}
        disabled={pending}
        aria-label="Follow-up status"
        className="w-32 capitalize"
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        {STATUSES.map((s) => (
          <option key={s} value={s} className="capitalize">
            {s}
          </option>
        ))}
      </NativeSelect>
    </form>
  );
}
