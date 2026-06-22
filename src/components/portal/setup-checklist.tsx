import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { SetupStatus } from "@/lib/data/setup";

/** "Get your AI ready" activation checklist. Renders nothing once setup is complete. */
export function SetupChecklist({ status }: { status: SetupStatus }) {
  if (status.complete) return null;
  const pct = Math.round((status.doneCount / status.total) * 100);

  return (
    <Card>
      <CardContent className="p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <p className="font-heading text-xl font-semibold tracking-tight">Get your AI ready</p>
          <span className="text-sm text-muted-foreground tabular-nums">
            {status.doneCount} of {status.total} done
          </span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          A few quick steps and your receptionist is ready to go live.
        </p>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
        </div>

        <ul className="mt-2">
          {status.steps.map((step) => (
            <li key={step.key} className="border-t first:border-t-0">
              {step.done ? (
                <div className="flex items-center gap-3 py-3">
                  <span className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                    <Check className="size-3.5" />
                  </span>
                  <span className="text-sm text-muted-foreground line-through">{step.label}</span>
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
      </CardContent>
    </Card>
  );
}
