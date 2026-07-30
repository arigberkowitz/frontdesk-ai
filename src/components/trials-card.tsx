"use client";

import { useActionState, startTransition } from "react";
import Link from "next/link";
import { Check, RefreshCw, Ticket, X } from "lucide-react";
import { toast } from "sonner";
import {
  approveTrialAction,
  declineTrialAction,
  endTrialAction,
  regenerateTrialCodeAction,
} from "@/lib/actions/trial";
import { initialActionState, type ActionState } from "@/lib/actions/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

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
  pending,
  active,
}: {
  code: string | null;
  pending: TrialRow[];
  active: TrialRow[];
}) {
  const approve = useToastAction(approveTrialAction);
  const decline = useToastAction(declineTrialAction);
  const end = useToastAction(endTrialAction);
  const regen = useToastAction(regenerateTrialCodeAction);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Ticket className="size-4" /> Free trials
        </CardTitle>
        <CardDescription>
          Give a business your code — they enter it on their Your AI page, you approve it here, and
          they get the full product free.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
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
                <Button
                  size="sm"
                  variant="outline"
                  disabled={end.pending}
                  onClick={() => end.run({ clientId: c.id })}
                >
                  End trial
                </Button>
              </div>
            ))}
          </div>
        ) : null}

        {pending.length === 0 && active.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No requests yet. Share the code with a business you want to win over.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
