"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { FEATURE_EXPLAINERS, type FeatureExplainer, type FeatureToggleKey } from "@/lib/feature-toggles";
import { cn } from "@/lib/utils";

/**
 * The small "What's this?" dropdown under a feature switch: what it does and
 * an example, in plain words. A real <button> with aria-expanded /
 * aria-controls, so it works from the keyboard and with a screen reader.
 * Copy comes from FEATURE_EXPLAINERS, so setup, Settings and the Overview say
 * the same thing.
 */
export function WhatsThis({
  feature,
  explainer,
  className,
}: {
  feature?: FeatureToggleKey;
  explainer?: FeatureExplainer;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const copy = explainer ?? (feature ? FEATURE_EXPLAINERS[feature] : null);
  if (!copy) return null;
  return (
    <div className={cn("mt-1", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded text-xs font-medium text-indigo-600 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        What&apos;s this?
        <ChevronDown aria-hidden className={cn("size-3.5 transition-transform", open && "rotate-180")} />
      </button>
      <div
        id={id}
        hidden={!open}
        className="mt-1.5 rounded-lg border border-indigo-500/15 bg-indigo-500/[0.04] px-3 py-2 text-xs leading-relaxed text-muted-foreground"
      >
        <p className="text-foreground/80">{copy.what}</p>
        <p className="mt-1">
          <span className="font-medium text-foreground/80">For example: </span>
          {copy.example}
        </p>
      </div>
    </div>
  );
}
