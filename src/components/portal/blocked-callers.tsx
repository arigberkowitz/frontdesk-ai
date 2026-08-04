"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Ban, ShieldCheck, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { blockNumberAction, unblockNumberAction } from "@/lib/actions/spam";
import { initialActionState, type ActionState } from "@/lib/actions/types";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatPhone } from "@/lib/format";

export interface SuggestedBlock {
  phone: string;
  calls: number;
  lastAt: Date | string | null;
}

function useToast(state: ActionState) {
  const router = useRouter();
  useEffect(() => {
    if (state.ok) {
      toast.success(state.message ?? "Done.");
      router.refresh();
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
}

function BlockButton({ clientId, phone }: { clientId: string; phone: string }) {
  const [state, action, pending] = useActionState(blockNumberAction, initialActionState);
  useToast(state);
  return (
    <form action={action}>
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="phone" value={phone} />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        <Ban className="size-3.5" />
        Block
      </Button>
    </form>
  );
}

function UnblockButton({ clientId, phone }: { clientId: string; phone: string }) {
  const [state, action, pending] = useActionState(unblockNumberAction, initialActionState);
  useToast(state);
  return (
    <form action={action}>
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="phone" value={phone} />
      <Button type="submit" size="sm" variant="ghost" disabled={pending}>
        <Undo2 className="size-3.5" />
        Unblock
      </Button>
    </form>
  );
}

/**
 * Blocked callers, and the repeat robocallers worth blocking.
 *
 * The point of counting spam is being able to do something about it. Blocking
 * is reversible and says so, because the failure that matters here is blocking
 * a real customer — which is why nothing is ever blocked automatically, and why
 * a number is only suggested after it has spammed more than once.
 */
export function BlockedCallers({
  clientId,
  blocked,
  suggested,
  timeZone,
}: {
  clientId: string;
  blocked: string[];
  suggested: SuggestedBlock[];
  timeZone?: string;
}) {
  if (!blocked.length && !suggested.length) return null;

  return (
    <div className="space-y-3 border-t pt-4">
      <div>
        <p className="text-sm font-medium">Blocked callers</p>
        <p className="text-xs text-muted-foreground">
          Blocked numbers still reach your phone line, but your AI stops talking to them — no
          message, no alert, and they don&apos;t count toward anything.
        </p>
      </div>

      {suggested.length ? (
        <ul className="space-y-1.5">
          {suggested.map((s) => (
            <li
              key={s.phone}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2"
            >
              <span className="text-sm">
                <strong className="tabular-nums">{formatPhone(s.phone)}</strong>{" "}
                <span className="text-muted-foreground">
                  — {s.calls} spam calls
                  {s.lastAt ? `, last ${formatDateTime(s.lastAt, timeZone)}` : ""}
                </span>
              </span>
              <BlockButton clientId={clientId} phone={s.phone} />
            </li>
          ))}
        </ul>
      ) : null}

      {blocked.length ? (
        <ul className="space-y-1">
          {blocked.map((phone) => (
            <li key={phone} className="flex items-center justify-between gap-2 py-0.5">
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <ShieldCheck className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                <span className="tabular-nums">{formatPhone(phone)}</span>
              </span>
              <UnblockButton clientId={clientId} phone={phone} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
