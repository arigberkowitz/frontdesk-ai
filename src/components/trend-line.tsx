import type { Trend } from "@/lib/trend";
import { cn } from "@/lib/utils";

/** "↑ 40% vs last week" under a metric — green up, rose down, quiet when flat. */
export function TrendLine({ trend, className }: { trend: Trend; className?: string }) {
  return (
    <p
      className={cn(
        "mt-0.5 text-xs font-medium tabular-nums",
        trend.tone === "up" && "text-emerald-600 dark:text-emerald-400",
        trend.tone === "down" && "text-rose-600 dark:text-rose-400",
        trend.tone === "flat" && "text-muted-foreground",
        className,
      )}
    >
      {trend.text}
    </p>
  );
}
