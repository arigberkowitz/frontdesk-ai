"use client";

import { Children, cloneElement, isValidElement, useId } from "react";
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

  type ControlProps = { id?: string; "aria-describedby"?: string; type?: string };
  const wire = (el: React.ReactElement<ControlProps>) =>
    cloneElement(el, {
      id: el.props.id ?? id,
      "aria-describedby": el.props["aria-describedby"] ?? describedBy,
    });
  let control = children;
  if (isValidElement<ControlProps>(children)) {
    control = wire(children);
  } else if (Array.isArray(children)) {
    // A control plus a helper next to it (<NativeSelect/> <WhatsThis/>): the
    // first real element is the control. Without this the label pointed at
    // nothing and screen readers announced an unnamed select.
    let wired = false;
    control = Children.map(children, (child) => {
      if (
        wired ||
        !isValidElement<ControlProps>(child) ||
        (child.type === "input" && child.props.type === "hidden")
      )
        return child;
      wired = true;
      return wire(child);
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
