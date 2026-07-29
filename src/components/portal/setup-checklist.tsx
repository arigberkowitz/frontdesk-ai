"use client";

import { useActionState, useEffect } from "react";
import Link from "next/link";
import { ArrowRight, Check, CheckCircle2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { finishSetupAction, reopenSetupAction } from "@/lib/actions/setup";
import { initialActionState } from "@/lib/actions/types";
import { formatDateTime } from "@/lib/format";

interface SetupStepView {
  key: string;
  label: string;
  href: string;
  done: boolean;
  hint?: string;
}

export interface SetupStatusView {
  steps: SetupStepView[];
  doneCount: number;
  total: number;
  complete: boolean;
  finishedAt: string | null;
}

/**
 * "Get your AI ready" checklist. Every item auto-checks off as the underlying
 * data appears and links straight to the tab where it's done. When everything
 * is checked the owner clicks "I'm done" → an AI reviewer double-checks the
 * whole setup → the card leaves the Overview and lives on under Settings →
 * Setup (variant="settings"), where it can be reopened or revisited anytime.
 */
export function SetupChecklist({
  status,
  clientId,
  variant = "overview",
  canEdit = true,
}: {
  status: SetupStatusView;
  clientId: string;
  variant?: "overview" | "settings";
  canEdit?: boolean;
}) {
  const [finishState, finishAction, finishing] = useActionState(
    finishSetupAction,
    initialActionState,
  );
  const [reopenState, reopenAction, reopening] = useActionState(
    reopenSetupAction,
    initialActionState,
  );

  useEffect(() => {
    if (finishState.ok) toast.success(finishState.message ?? "Setup complete.");
    else if (finishState.error) toast.error(finishState.error, { duration: 9000 });
  }, [finishState]);
  useEffect(() => {
    if (reopenState.ok) toast.success(reopenState.message ?? "Reopened.");
    else if (reopenState.error) toast.error(reopenState.error);
  }, [reopenState]);

  // Overview: once finished (AI-checked), the card disappears entirely.
  if (variant === "overview" && status.finishedAt) return null;

  const pct = Math.round((status.doneCount / status.total) * 100);
  const finished = Boolean(status.finishedAt);

  return (
    <Card>
      <CardContent className="p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <p className="font-heading text-xl font-semibold tracking-tight">
            {variant === "settings" ? "Setup" : "Get your AI ready"}
          </p>
          {finished ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-3.5" />
              Complete{status.finishedAt ? ` · ${formatDateTime(new Date(status.finishedAt))}` : ""}
            </span>
          ) : (
            <span className="text-sm text-muted-foreground tabular-nums">
              {status.doneCount} of {status.total} done
            </span>
          )}
        </div>
        {!finished ? (
          <>
            <p className="mt-1 text-sm text-muted-foreground">
              Click any step to jump where it happens — each one checks itself off as you go.
            </p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            Everything&apos;s set. Change anything anytime in its own tab — or reopen the checklist on
            your Overview.
          </p>
        )}

        <ul className="mt-2">
          {status.steps.map((step) => (
            <li key={step.key} className="border-t first:border-t-0">
              {step.done ? (
                <div className="flex items-center gap-3 py-3">
                  <span className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                    <Check className="size-3.5" />
                  </span>
                  <span className="flex-1 text-sm text-muted-foreground line-through">
                    {step.label}
                  </span>
                  <Link
                    href={step.href}
                    className="text-xs text-muted-foreground/70 transition-colors hover:text-foreground"
                  >
                    Change
                  </Link>
                </div>
              ) : (
                <Link
                  href={step.href}
                  className="group flex items-center gap-3 py-3 transition-colors hover:text-foreground"
                >
                  <span className="size-[22px] shrink-0 rounded-full border-[1.5px] border-muted-foreground/40" />
                  <span className="flex-1">
                    <span className="block text-sm font-medium">{step.label}</span>
                    {step.hint ? (
                      <span className="block text-xs text-muted-foreground">{step.hint}</span>
                    ) : null}
                  </span>
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-foreground" />
                </Link>
              )}
            </li>
          ))}
        </ul>

        {canEdit && !finished ? (
          <form action={finishAction} className="mt-4 border-t pt-4">
            <input type="hidden" name="clientId" value={clientId} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {status.complete
                  ? "All checked — the AI gives everything a final once-over before you're done."
                  : "Finish the steps above, then run the final check."}
              </p>
              <Button type="submit" size="sm" disabled={!status.complete || finishing}>
                <Sparkles className="size-3.5" />
                {finishing ? "AI is checking…" : "I'm done — run the final check"}
              </Button>
            </div>
          </form>
        ) : null}

        {canEdit && finished && variant === "settings" ? (
          <form action={reopenAction} className="mt-4 border-t pt-4">
            <input type="hidden" name="clientId" value={clientId} />
            <div className="flex justify-end">
              <Button type="submit" size="sm" variant="outline" disabled={reopening}>
                {reopening ? "Reopening…" : "Reopen checklist on Overview"}
              </Button>
            </div>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
