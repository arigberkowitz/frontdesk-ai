"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { MetricIconChip, type MetricIcon } from "@/components/metric-accent";
import { CountUp } from "@/components/count-up";
import { Sparkline } from "@/components/charts/sparkline";

interface MetricBreakdownProps {
  label: string;
  value: string;
  hint?: string;
  icon?: MetricIcon;
  breakdown: string[];
  href?: string;
  spark?: number[];
  sparkColor?: string;
  className?: string;
}

/** Client island for a metric that expands its breakdown on click. */
export function MetricBreakdown({ label, value, hint, icon, breakdown, href, spark, sparkColor, className }: MetricBreakdownProps) {
  const [open, setOpen] = useState(false);

  return (
    <Card className={cn("fd-lift overflow-hidden", className)}>
      <CardContent className="p-5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="block w-full cursor-pointer text-left"
          aria-expanded={open}
        >
          <div className="flex min-h-8 items-center justify-between gap-2">
            <MetricIconChip icon={icon} />
            <ChevronDown
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform",
                open && "rotate-180",
              )}
            />
          </div>
          <p className={cn("font-heading text-3xl font-semibold tracking-tight tabular-nums", icon && "mt-3")}>
            <CountUp value={value} />
          </p>
          <p className="mt-1 text-sm font-medium text-muted-foreground">{label}</p>
          {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
          {spark && spark.length > 1 ? (
            <Sparkline data={spark} color={sparkColor} className="mt-3 h-6 w-full" />
          ) : null}
        </button>
        {open ? (
          <div className="mt-3 space-y-1 border-t pt-3 text-xs text-muted-foreground">
            {breakdown.map((line, i) => (
              <p key={`${i}-${line}`} className="tabular-nums">
                {line}
              </p>
            ))}
            {href ? (
              <Link
                href={href}
                className="mt-1 inline-block font-medium text-foreground underline underline-offset-2"
              >
                View all →
              </Link>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
