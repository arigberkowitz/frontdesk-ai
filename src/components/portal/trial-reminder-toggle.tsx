"use client";

import { useActionState } from "react";
import { Bell, BellOff } from "lucide-react";
import { toast } from "sonner";
import { setTrialReminderAction } from "@/lib/actions/trial-nudges";
import { initialActionState, type ActionState } from "@/lib/actions/types";

/** Opt-in "email me 3 days before my trial ends". Off by default. */
export function TrialReminderToggle({ clientId, on }: { clientId: string; on: boolean }) {
  const [, action, pending] = useActionState(async (prev: ActionState, fd: FormData) => {
    const next = await setTrialReminderAction(prev, fd);
    if (next.ok && next.message) toast.success(next.message);
    else if (next.error) toast.error(next.error);
    return next;
  }, initialActionState);

  return (
    <form action={action}>
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="on" value={on ? "false" : "true"} />
      <button
        type="submit"
        disabled={pending}
        aria-pressed={on}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-60"
      >
        {on ? <BellOff className="size-3.5" /> : <Bell className="size-3.5" />}
        {on ? "Reminder on (3 days before) — turn off" : "Email me 3 days before it ends"}
      </button>
    </form>
  );
}
