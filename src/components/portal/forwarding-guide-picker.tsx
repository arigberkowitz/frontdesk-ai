"use client";

import { useState } from "react";
import { ExternalLink, Info } from "lucide-react";
import {
  FORWARDING_GUIDES,
  GUIDES_CHECKED_ON,
  guideFor,
  type ForwardingGuide,
  type GuideMode,
} from "@/lib/forwarding-guides";
import { cn } from "@/lib/utils";

const GROUPS: { id: ForwardingGuide["group"]; title: string }[] = [
  { id: "mobile", title: "Mobile carrier" },
  { id: "office", title: "Office phone system" },
];

function checkedLabel(): string {
  return new Date(`${GUIDES_CHECKED_ON}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * "What phone service do you have?" The steps differ a lot (star codes on a
 * mobile phone, a web portal on RingCentral), so the owner picks theirs and
 * sees the steps for the plan's mode, with the vendor's own help page linked.
 */
export function ForwardingGuidePicker({
  mode,
  phoneNumber,
}: {
  mode: GuideMode;
  phoneNumber: string;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const guide = FORWARDING_GUIDES.find((g) => g.id === selected) ?? null;
  const view = guide ? guideFor(guide, mode, phoneNumber) : null;

  return (
    <section className="space-y-3 rounded-xl border p-4" data-testid="forwarding-guides">
      <div>
        <h3 className="font-heading text-base font-semibold">Set it up on your phone service</h3>
        <p className="text-sm text-muted-foreground">
          The codes above work on most mobile and landline phones. Office phone systems often do it
          in a settings page instead. Pick yours.
        </p>
      </div>

      <div className="space-y-3">
        {GROUPS.map((group) => (
          <div key={group.id} className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">{group.title}</p>
            <div className="flex flex-wrap gap-2">
              {FORWARDING_GUIDES.filter((g) => g.group === group.id).map((g) => (
                <button
                  key={g.id}
                  type="button"
                  aria-pressed={selected === g.id}
                  onClick={() => setSelected(selected === g.id ? null : g.id)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                    selected === g.id
                      ? "border-primary bg-primary text-primary-foreground"
                      : "bg-background hover:border-muted-foreground/50 hover:bg-muted",
                  )}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {guide && view ? (
        <div className="space-y-3 rounded-lg bg-muted/40 p-4" data-testid="forwarding-guide-steps">
          <p className="text-sm font-semibold">
            {guide.label}:{" "}
            <span className="font-normal text-muted-foreground">
              {mode === "missed_only"
                ? "forward busy and unanswered calls"
                : "forward every call"}
            </span>
          </p>
          <ol className="list-decimal space-y-1.5 pl-5 text-sm">
            {view.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          {view.checkWithProvider ? (
            <p className="flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <Info className="mt-0.5 size-4 shrink-0" />
              <span>
                <strong>Check with your provider.</strong> {view.checkWithProvider}
              </span>
            </p>
          ) : null}
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>
              From the provider&apos;s own help pages, checked {checkedLabel()}. Menus change, so
              if yours looks different, trust the provider&apos;s page.
            </p>
            <ul className="space-y-0.5">
              {guide.sources.map((src) => (
                <li key={src.url}>
                  <a
                    href={src.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground"
                  >
                    {src.label}
                    <ExternalLink className="size-3" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Not sure which you have? Pick Other, or look at the company name on your phone bill.
        </p>
      )}
    </section>
  );
}
