"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface MetricBreakdownProps {
  label: string;
  value: string;
  hint?: string;
  breakdown: string[];
  href?: string;
  className?: string;
}

/** Client island for a metric that expands its breakdown on click. Receives only
 *  serializable strings — no icon — so it's safe to render from a server page. */
export function MetricBreakdown({ label, value, hint, breakdown, href, className }: MetricBreakdownProps) {
  const [open, setOpen] = useState(false);

  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardContent className="p-5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="block w-full cursor-pointer text-left"
          aria-expanded={open}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-muted-foreground">{label}</p>
            <ChevronDown
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform",
                open && "rotate-180",
              )}
            />
          </div>
          <p className="mt-2 font-heading text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
          {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
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
