"use client";

import { startTransition, useActionState, useId, useOptimistic, useState } from "react";
import Link from "next/link";
import { Lock, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { WhatsThis } from "@/components/portal/feature-explainer";
import { initialActionState, type ActionState } from "@/lib/actions/types";
import type { FeatureStatus } from "@/lib/ai-features";
import type { FeatureExplainer } from "@/lib/feature-toggles";
import { cn } from "@/lib/utils";

export type ServerAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export function toForm(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}

type Note = { note: string; href?: string; label?: string };

/**
 * One feature switch: title, short description, optional status line, a
 * "What's this?" explainer, and the switch. Saves through the feature's
 * EXISTING server action (so its own permission checks apply), optimistic with
 * rollback, and asks once before turning on anything that reaches customers.
 *
 * Used by the Overview "AI features" switchboard and the Settings → Features
 * list (the guided-setup step), so both behave identically.
 */
export function FeatureSwitchRow({
  icon: Icon,
  title,
  description,
  explainer,
  status = null,
  statusLink,
  initialOn,
  isAdmin,
  action,
  form,
  confirmNotes,
  onSaved,
  nested = false,
  locked,
  needs,
  fixed,
  warning,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  description: string;
  explainer?: FeatureExplainer;
  status?: FeatureStatus | null;
  statusLink?: { href: string; label: string };
  initialOn: boolean;
  isAdmin: boolean;
  action: ServerAction;
  form: (on: boolean) => FormData;
  /** Shown before turning ON; null = no confirmation needed (nothing reaches customers). */
  confirmNotes: string[] | null;
  onSaved?: (on: boolean) => void;
  nested?: boolean;
  /** Not on this plan: switch disabled, with a one-line upgrade note. */
  locked?: Note;
  /** Missing something before it can be turned ON (turning off still works). */
  needs?: Note;
  /** Set elsewhere; this switch can't change it. */
  fixed?: Note;
  /** On, but something stops it working. */
  warning?: Note;
  children?: React.ReactNode;
}) {
  const id = useId();
  const [saved, save, pending] = useActionState(async (prevOn: boolean, next: boolean) => {
    const r = await action(initialActionState, form(next));
    if (r.ok) {
      toast.success(r.message ?? "Saved.");
      onSaved?.(next);
      return next;
    }
    const fieldError = r.fieldErrors ? Object.values(r.fieldErrors).flat()[0] : undefined;
    toast.error(r.error ?? fieldError ?? "Couldn't save that — please try again.");
    return prevOn;
  }, initialOn);
  const [shown, setShown] = useOptimistic(saved);
  const [confirming, setConfirming] = useState(false);

  const commit = (next: boolean) => {
    setConfirming(false);
    startTransition(() => {
      setShown(next);
      save(next);
    });
  };
  const onChange = (next: boolean) => {
    if (next && confirmNotes) setConfirming(true);
    else commit(next);
  };

  // Locked / missing-something rows can't be turned ON, but one that's already
  // on can always be switched off. A "fixed" row can't change from here at all.
  const disabled = !isAdmin || pending || Boolean(fixed) || (!shown && Boolean(locked || needs));
  const tone = pending ? "on" : (status?.tone ?? "off");
  const note: (Note & { tone: "lock" | "warn" | "muted" }) | null = locked
    ? { ...locked, tone: "lock" }
    : fixed
      ? { ...fixed, tone: "muted" }
      : needs && !shown
        ? { ...needs, tone: "muted" }
        : warning && shown
          ? { ...warning, tone: "warn" }
          : null;

  return (
    <li
      className={cn(
        nested ? "mt-3 rounded-lg border border-border/70 bg-muted/30 p-3" : "py-4 first:pt-2 last:pb-0",
      )}
    >
      <div className="flex items-start gap-3">
        {nested || !Icon ? null : (
          <span
            className={cn(
              "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg",
              locked ? "bg-muted text-muted-foreground" : "bg-indigo-500/10 text-indigo-600",
            )}
          >
            <Icon className="size-4" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <label htmlFor={id} className="flex flex-wrap items-center gap-x-2 text-sm font-medium">
            {title}
            {locked ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                <Lock aria-hidden className="size-3" />
                Pro
              </span>
            ) : null}
          </label>
          <p className="text-sm text-muted-foreground">{description}</p>
          {status || pending || confirming ? (
            <p className="mt-1 flex items-start gap-2 text-xs" aria-live="polite">
              <span
                aria-hidden
                className={cn(
                  "mt-[5px] inline-block size-1.5 shrink-0 rounded-full",
                  tone === "on" ? "bg-emerald-500" : tone === "warn" ? "bg-amber-500" : "bg-muted-foreground/40",
                )}
              />
              <span className={cn("min-w-0", tone === "warn" ? "text-amber-700" : "text-muted-foreground")}>
                {pending ? "Saving…" : confirming ? "Not on yet — confirm below" : status?.text}
                {statusLink && !pending ? (
                  <>
                    {" "}
                    <Link href={statusLink.href} className="font-medium text-foreground underline underline-offset-2">
                      {statusLink.label}
                    </Link>
                  </>
                ) : null}
              </span>
            </p>
          ) : null}
          {note ? (
            <p
              className={cn(
                "mt-1 flex items-start gap-1.5 text-xs",
                note.tone === "warn" ? "text-amber-700" : "text-muted-foreground",
              )}
            >
              {note.tone === "lock" ? <Lock aria-hidden className="mt-0.5 size-3 shrink-0" /> : null}
              <span className="min-w-0">
                {note.note}
                {note.href && note.label ? (
                  <>
                    {" "}
                    <Link href={note.href} className="font-medium text-foreground underline underline-offset-2">
                      {note.label}
                    </Link>
                  </>
                ) : null}
              </span>
            </p>
          ) : null}
          {explainer ? <WhatsThis explainer={explainer} /> : null}
        </div>
        <Switch
          id={id}
          checked={shown || confirming}
          onCheckedChange={onChange}
          disabled={disabled}
          aria-label={`${title}: ${shown ? "on" : "off"}`}
          className="mt-1"
        />
      </div>
      {confirming && confirmNotes ? (
        <div className={cn("mt-3 rounded-lg border border-indigo-500/25 bg-indigo-500/5 p-3 text-sm", Icon && !nested && "sm:ml-11")}>
          <p className="font-medium">Before you turn this on</p>
          <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
            {confirmNotes.map((n) => (
              <li key={n}>· {n}</li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => commit(true)}>
              Turn on
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Not now
            </Button>
          </div>
        </div>
      ) : null}
      {/* Children are nested rows (<li>), so they need their own list. */}
      {children ? <ul className={nested || !Icon ? "" : "sm:ml-11"}>{children}</ul> : null}
    </li>
  );
}
