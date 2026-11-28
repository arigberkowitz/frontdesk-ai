"use client";

import { useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, CircleSlash, Loader2, RotateCcw, XCircle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ChecklistLine, StepResult } from "@/lib/operator/controls";

/** What every operator route answers with (controls.ts ControlResult, or an orphan delete). */
export interface ControlResponse {
  ok: boolean;
  message: string;
  steps?: StepResult[];
  /** Full delete: what each vendor still holds, re-queried. */
  checklist?: ChecklistLine[];
}

/**
 * One confirm dialog for every destructive operator action.
 *
 * It states exactly what will happen before the click, optionally makes the
 * operator type the business name, and after the click shows the result step
 * by step. When a vendor step fails, the failed step is named and a Retry button
 * re-sends the same request — every action is idempotent, so only what's left
 * runs again.
 */
export function ControlDialog({
  open,
  onOpenChange,
  title,
  willHappen,
  note,
  confirmLabel,
  tone = "destructive",
  typeToConfirm,
  extra,
  send,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Plain-English list of exactly what the button does. */
  willHappen: ReactNode[];
  note?: ReactNode;
  confirmLabel: string;
  tone?: "destructive" | "default";
  /** Operator must type this exactly before the confirm button enables. */
  typeToConfirm?: string;
  extra?: ReactNode;
  /** Sends the request. Must not throw. */
  send: (typed: string) => Promise<ControlResponse>;
  /** Called once after a fully successful run when the dialog is closed. */
  onDone: (res: ControlResponse) => void;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ControlResponse | null>(null);

  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const typedOk = !typeToConfirm || (norm(typed).length > 0 && norm(typed) === norm(typeToConfirm));

  async function run() {
    setBusy(true);
    const res = await send(typed);
    setBusy(false);
    setResult(res);
    // Refresh the page behind the dialog on any outcome so it shows what changed.
    onDone(res);
  }

  function close(next: boolean) {
    if (busy) return;
    if (!next) {
      setResult(null);
      setTyped("");
    }
    onOpenChange(next);
  }

  const failed = result && !result.ok;

  return (
    <AlertDialog open={open} onOpenChange={close}>
      <AlertDialogContent className="data-[size=default]:sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>{result ? (result.ok ? "Done" : "Not finished") : title}</AlertDialogTitle>
          <AlertDialogDescription render={<div />}>
            {result ? (
              <div className="space-y-3 text-left">
                <p className={failed ? "font-medium text-destructive" : "font-medium text-emerald-700"}>{result.message}</p>
                {result.checklist?.length ? <Checklist lines={result.checklist} /> : null}
                {result.steps?.length ? <StepList steps={result.steps} /> : null}
              </div>
            ) : (
              <div className="space-y-3 text-left">
                <p className="font-medium text-foreground">This will:</p>
                <ul className="list-disc space-y-1 pl-5">
                  {willHappen.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
                {note ? <p className="text-xs">{note}</p> : null}
              </div>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {!result ? (
          <div className="space-y-3">
            {extra}
            {typeToConfirm ? (
              <label className="block space-y-1 text-sm">
                <span>
                  Type <strong className="font-semibold">{typeToConfirm}</strong> to confirm
                </span>
                <Input
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  autoComplete="off"
                  aria-label={`Type ${typeToConfirm} to confirm`}
                />
              </label>
            ) : null}
          </div>
        ) : null}

        <AlertDialogFooter>
          {result ? (
            <>
              <AlertDialogCancel disabled={busy}>Close</AlertDialogCancel>
              {failed ? (
                <Button onClick={run} disabled={busy}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
                  Retry
                </Button>
              ) : null}
            </>
          ) : (
            <>
              <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
              <Button
                variant={tone === "destructive" ? "destructive" : "default"}
                disabled={!typedOk || busy}
                onClick={run}
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                {confirmLabel}
              </Button>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * The proof: what each vendor still holds right now, asked again after the work.
 * Green only when a line is zero; a red line means it is NOT clean, whatever else says "done".
 */
export function Checklist({ lines }: { lines: ChecklistLine[] }) {
  const clean = lines.every((l) => l.zero);
  return (
    <div
      role="group"
      aria-label="Verification"
      data-testid="delete-checklist"
      className={`rounded-lg border p-3 ${clean ? "border-emerald-200 bg-emerald-50" : "border-destructive/40 bg-destructive/5"}`}
    >
      <p className={`mb-1.5 text-xs font-semibold uppercase tracking-wide ${clean ? "text-emerald-800" : "text-destructive"}`}>
        {clean ? "Checked just now: all zero" : "Checked just now: not clean"}
      </p>
      <ul className="space-y-1 text-sm">
        {lines.map((l) => (
          <li key={l.vendor} className="flex items-start gap-2">
            {l.zero ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-label="Zero" />
            ) : (
              <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-label="Not zero" />
            )}
            <span className="text-foreground">
              <span className="font-medium">{l.vendor}:</span> {l.text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Step-by-step outcome, failed steps first-class and red. */
export function StepList({ steps }: { steps: StepResult[] }) {
  return (
    <ul className="space-y-1.5" aria-label="Steps">
      {steps.map((s, i) => (
        <li key={`${s.step}-${i}`} className="flex items-start gap-2 text-sm">
          {s.status === "failed" ? (
            <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-label="Failed" />
          ) : s.status === "skipped" ? (
            <CircleSlash className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="Skipped" />
          ) : s.status === "already_gone" ? (
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-label="Already gone" />
          ) : (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-label="Done" />
          )}
          <span className="min-w-0">
            <span className={s.status === "failed" ? "font-medium text-foreground" : "text-foreground"}>{s.label}</span>
            {s.status === "already_gone" ? <span className="text-muted-foreground"> — already gone at the vendor (counts as done)</span> : null}
            {s.detail ? <span className="block break-words text-xs text-muted-foreground">{s.detail}</span> : null}
            {s.error ? <span className="block break-words text-xs text-destructive">{s.error}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** POST JSON to an operator route and normalise every outcome into a ControlResponse. Never throws. */
export async function postControl(url: string, payload: Record<string, unknown>): Promise<ControlResponse> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await res.json().catch(() => null)) as ControlResponse | null;
    if (json && typeof json.message === "string") return { ...json, ok: res.ok && json.ok !== false };
    return { ok: false, message: res.status === 403 ? "You don't have permission to do that." : `Request failed (${res.status}).` };
  } catch {
    return { ok: false, message: "Couldn't reach the server. Nothing was changed that we know of — try again." };
  }
}
