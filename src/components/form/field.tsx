"use client";

import { cloneElement, isValidElement, useId } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Labelled form field. Auto-associates the <Label> with its control: a generated
 * id (and aria-describedby for hint/error) is injected onto a single child that
 * doesn't already set them, so click-to-focus and screen readers work without
 * every call site threading an id by hand.
 */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  className,
  children,
}: {
  label?: string;
  htmlFor?: string;
  error?: string[];
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const generatedId = useId();
  const id = htmlFor ?? generatedId;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error?.length ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  let control = children;
  if (isValidElement<{ id?: string; "aria-describedby"?: string }>(children)) {
    control = cloneElement(children, {
      id: children.props.id ?? id,
      "aria-describedby": children.props["aria-describedby"] ?? describedBy,
    });
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      {label ? <Label htmlFor={id}>{label}</Label> : null}
      {control}
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error?.length ? (
        <p id={errorId} className="text-xs text-destructive">
          {error[0]}
        </p>
      ) : null}
    </div>
  );
}
