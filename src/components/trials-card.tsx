"use client";

import { useActionState, startTransition } from "react";
import Link from "next/link";
import { Check, ChevronDown, RefreshCw, Ticket, X } from "lucide-react";
import { TRIAL_DAYS } from "@/config/plans";
import { toast } from "sonner";
import {
  approveTrialAction,
  declineTrialAction,
  compClientAction,
  endTrialAction,
  regenerateTrialCodeAction,
  setTrialCodeAction,
} from "@/lib/actions/trial";
import { initialActionState, type ActionState } from "@/lib/actions/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { Pencil } from "lucide-react";

type TrialAction = (prev: ActionState, fd: FormData) => Promise<ActionState>;

function useToastAction(serverAction: TrialAction) {
  const [, action, pending] = useActionState(async (prev: ActionState, fd: FormData) => {
    const next = await serverAction(prev, fd);
    if (next.ok) toast.success(next.message ?? "Done.");
    else if (next.error) toast.error(next.error);
    return next;
  }, initialActionState);
  const run = (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    startTransition(() => action(fd));
  };
  return { run, pending };
}

export interface TrialRow {
  id: string;
  name: string;
  requestedAt: string | null;
  trialEndsAt: string | null;
  status: string;
}

/**
 * Operator dashboard: hand out the trial access code, approve/decline requests,
 * and end running trials. The code alone never activates anything — every trial
 * is explicitly approved here.
 */
export function TrialsCard({
  code,
  compCode,
  pending,
  active,
}: {
  code: string | null;
  /** The unlimited-access code, from the environment. Null when none is set. */
  compCode: string | null;
  pending: TrialRow[];
  active: TrialRow[];
}) {
  const approve = useToastAction(approveTrialAction);
  const decline = useToastAction(declineTrialAction);
  const end = useToastAction(endTrialAction);
  const comp = useToastAction(compClientAction);
  const regen = useToastAction(regenerateTrialCodeAction);
  const setCode = useToastAction(setTrialCodeAction);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  // The card earns the top of the dashboard only when something in it needs a
  // decision. The rest of the time it folds to one line — this page is for
  // the numbers, not for re-reading your own trial code every morning.
  const needsAttention = pending.length > 0;

  return (
    <details
      open={needsAttention}
      className="group rounded-xl border bg-card text-card-foreground shadow-sm"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-6 py-4 [&::-webkit-details-marker]:hidden">
        <Ticket className="size-4" />
        <span className="font-heading font-semibold">Free trials</span>
        {needsAttention ? (
          <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
            {pending.length} request{pending.length === 1 ? "" : "s"} waiting
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">
            {active.length > 0
              ? `${active.length} on trial`
              : code
                ? "codes & approvals"
                : "no code yet"}
          </span>
        )}
        <ChevronDown className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-4 border-t px-6 py-5">
        <p className="text-sm text-muted-foreground">
          Everyone who signs up already gets {TRIAL_DAYS} days free with no card. These codes are
          for the exceptions: extending someone, or putting a business you know on the house for
          good.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Your code:</span>
          {code ? (
            <button
              type="button"
              className="rounded-md border bg-muted/40 px-2.5 py-1 font-mono text-sm font-semibold tracking-wide hover:bg-muted"
              title="Click to copy"
              onClick={() => {
                navigator.clipboard?.writeText(code);
                toast.success("Code copied.");
              }}
            >
              {code}
            </button>
          ) : (
            <span className="text-sm text-muted-foreground">none yet</span>
          )}
          <Button
            variant="ghost"
            size="sm"
            disabled={regen.pending}
            onClick={() => regen.run({})}
            className="text-muted-foreground"
          >
            <RefreshCw className="size-3.5" />
            {code ? "New code" : "Generate code"}
          </Button>
        </div>

        {/* Unlimited access, for a business you know. Lives in an env var, not
            the database — nothing that grants free service forever belongs in a
            table that gets exported or rendered by accident — so it's read-only
            here and changed in Vercel. */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Unlimited code:</span>
          {compCode ? (
            <button
              type="button"
              className="rounded-md border border-emerald-500/40 bg-emerald-500/5 px-2.5 py-1 font-mono text-sm font-semibold tracking-wide hover:bg-emerald-500/10"
              title="Click to copy"
              onClick={() => {
                navigator.clipboard?.writeText(compCode);
                toast.success("Unlimited code copied.");
              }}
            >
              {compCode}
            </button>
          ) : (
            <span className="text-sm text-muted-foreground">
              not set — add COMP_ACCESS_CODE in Vercel
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            Full product, free, no expiry, no approval needed.
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => {
              setDraft(code ?? "");
              setEditing((v) => !v);
            }}
          >
            <Pencil className="size-3.5" />
            {editing ? "Cancel" : "Set my own trial code"}
          </Button>
        </div>

        {editing ? (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setCode.run({ code: draft });
              setEditing(false);
            }}
          >
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="ARI2026"
              autoComplete="off"
              className="max-w-45 font-mono uppercase"
              maxLength={24}
              required
            />
            <Button type="submit" size="sm" disabled={setCode.pending}>
              Save code
            </Button>
          </form>
        ) : null}

        {pending.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">Waiting for your approval</p>
            {pending.map((c) => (
              <div
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-amber-500/5 p-3"
              >
                <div className="text-sm">
                  <Link href={`/clients/${c.id}`} className="font-medium hover:underline">
                    {c.name}
                  </Link>
                  {c.requestedAt ? (
                    <span className="ml-2 text-xs text-muted-foreground">
                      asked {new Date(c.requestedAt).toLocaleDateString()}
                    </span>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" disabled={approve.pending} onClick={() => approve.run({ clientId: c.id })}>
                    <Check className="size-3.5" /> Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={decline.pending}
                    onClick={() => decline.run({ clientId: c.id })}
                  >
                    <X className="size-3.5" /> Decline
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {active.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">On trial</p>
            {active.map((c) => (
              <div
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
              >
                <div className="text-sm">
                  <Link href={`/clients/${c.id}`} className="font-medium hover:underline">
                    {c.name}
                  </Link>
                  {c.trialEndsAt ? (
                    <span className="ml-2 text-xs text-muted-foreground">
                      until {new Date(c.trialEndsAt).toLocaleDateString()}
                    </span>
                  ) : null}
                </div>
                <span className="flex gap-2">
                  {/* No code to type and no env var to have remembered. */}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={comp.pending}
                    onClick={() => comp.run({ clientId: c.id })}
                  >
                    Put on the house
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={end.pending}
                    onClick={() => end.run({ clientId: c.id })}
                  >
                    End trial
                  </Button>
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {pending.length === 0 && active.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No requests yet. Share the code with a business you want to win over.
          </p>
        ) : null}
      </div>
    </details>
  );
}
