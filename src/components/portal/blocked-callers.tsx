"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Ban, PhoneIncoming, ShieldCheck, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { allowNumberAction, blockNumberAction, unblockNumberAction } from "@/lib/actions/spam";
import { initialActionState, type ActionState } from "@/lib/actions/types";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatPhone } from "@/lib/format";

export interface SuggestedBlock {
  phone: string;
  calls: number;
  lastAt: Date | string | null;
  /** "spam": classified as spam on 2+ calls. "silent": 3+ calls with nothing said. */
  reason?: "spam" | "silent";
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

function AllowButton({ clientId, phone }: { clientId: string; phone: string }) {
  const [state, action, pending] = useActionState(allowNumberAction, initialActionState);
  useToast(state);
  return (
    <form action={action}>
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="phone" value={phone} />
      <Button type="submit" size="sm" variant="ghost" disabled={pending}>
        <PhoneIncoming className="size-3.5" />
        Let through
      </Button>
    </form>
  );
}

/**
 * Blocked callers, and the repeat robocallers worth blocking.
 *
 * The point of counting spam is being able to do something about it. Blocking
 * is reversible and says so, because the failure that matters here is blocking
 * a real customer — which is why the owner's list is only ever filled by the
 * owner, a number is only suggested after it has spammed more than once (or
 * called silently three times), and the one automatic rule (3 spam calls in 30
 * days, never a booking or a message: spam.ts) ages out on its own.
 */
export function BlockedCallers({
  clientId,
  blocked,
  suggested,
  autoRejected = [],
  timeZone,
}: {
  clientId: string;
  blocked: string[];
  suggested: SuggestedBlock[];
  /** Turned away by the automatic rule right now (3 spam calls in 30 days). */
  autoRejected?: SuggestedBlock[];
  timeZone?: string;
}) {
  if (!blocked.length && !suggested.length && !autoRejected.length) return null;

  return (
    <div className="space-y-3 border-t pt-4">
      <div>
        <p className="text-sm font-medium">Blocked callers</p>
        <p className="text-xs text-muted-foreground">
          Your AI hangs up on blocked numbers before it answers, so they use no minutes and send no
          alerts. A number marked as spam on 3 calls in 30 days, that never booked or left a
          message, is turned away the same way; tap Let through if it&apos;s someone you know.
          Numbers with only a Block button are suggestions: nothing happens until you tap it.
        </p>
      </div>

      {suggested.length ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Worth blocking</p>
          <ul className="space-y-1.5">
            {suggested.map((s) => (
              <li
                key={s.phone}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2"
              >
                <span className="text-sm">
                  <strong className="tabular-nums">{formatPhone(s.phone)}</strong>{" "}
                  <span className="text-muted-foreground">
                    —{" "}
                    {s.reason === "silent"
                      ? `${s.calls} calls with nothing said`
                      : `${s.calls} spam calls`}
                    {s.lastAt ? `, last ${formatDateTime(s.lastAt, timeZone)}` : ""}
                  </span>
                </span>
                <BlockButton clientId={clientId} phone={s.phone} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {autoRejected.length ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Turned away automatically</p>
          <ul className="space-y-1.5">
            {autoRejected.map((s) => (
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
                <span className="flex items-center gap-1">
                  <AllowButton clientId={clientId} phone={s.phone} />
                  <BlockButton clientId={clientId} phone={s.phone} />
                </span>
              </li>
            ))}
          </ul>
        </div>
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
