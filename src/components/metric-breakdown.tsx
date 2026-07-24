"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { MetricIconChip, type MetricIcon } from "@/components/metric-accent";
import { METRIC_SIZES, type MetricSize } from "@/components/metric-card";
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
  size?: MetricSize;
  className?: string;
}

/** Client island for a metric that expands its breakdown on click. */
export function MetricBreakdown({ label, value, hint, icon, breakdown, href, spark, sparkColor, size = "default", className }: MetricBreakdownProps) {
  const [open, setOpen] = useState(false);
  const s = METRIC_SIZES[size];

  return (
    <Card className={cn("fd-lift overflow-hidden", className)}>
      <CardContent className={s.pad}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="block w-full cursor-pointer rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
          <p className={cn("font-heading font-semibold tracking-tight tabular-nums", s.num, icon && "mt-3")}>
            <CountUp value={value} />
          </p>
          <p className="mt-1 text-sm font-medium text-muted-foreground">{label}</p>
          {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
          {spark && spark.length > 1 ? (
            <Sparkline data={spark} color={sparkColor} className={cn("w-full", s.spark)} />
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
