import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { MetricBreakdown } from "@/components/metric-breakdown";
import { MetricIconChip, type MetricIcon } from "@/components/metric-accent";
import { CountUp } from "@/components/count-up";
import { Sparkline } from "@/components/charts/sparkline";

export type MetricSize = "hero" | "default" | "sm";

/** Two deliberate steps of visual weight: one lead stat, quieter supporting stats. */
export const METRIC_SIZES: Record<
  MetricSize,
  { pad: string; num: string; spark: string }
> = {
  hero: { pad: "p-6", num: "text-4xl sm:text-[2.75rem]", spark: "mt-4 h-10" },
  default: { pad: "p-5", num: "text-3xl", spark: "mt-3 h-6" },
  sm: { pad: "p-4", num: "text-2xl", spark: "mt-2 h-5" },
};

interface MetricCardProps {
  label: string;
  value: string;
  /** A second figure that belongs WITH the headline — e.g. money booked
   *  ahead sitting under money earned. Rendered quieter and inline so the
   *  two read as one fact, not two competing numbers. */
  sub?: string;
  hint?: string;
  /** Leading accent icon-chip; binds to a fixed color in the registry. */
  icon?: MetricIcon;
  /** When set, the card links to the underlying records. */
  href?: string;
  /** When set, clicking the card expands these fact lines (the breakdown). */
  breakdown?: string[];
  /** Optional 14-day trend series rendered as a sparkline under the number. */
  spark?: number[];
  sparkColor?: string;
  /** hero = lead stat (bigger number, taller spark); sm = quiet supporting stat. */
  size?: MetricSize;
  className?: string;
}

/** Big, legible stat. Optionally links to the records, or expands a breakdown on click. */
export function MetricCard({ label, value, sub, hint, icon, href, breakdown, spark, sparkColor, size = "default", className }: MetricCardProps) {
  if (breakdown && breakdown.length > 0) {
    return (
      <MetricBreakdown
        label={label}
        value={value}
        sub={sub}
        hint={hint}
        icon={icon}
        breakdown={breakdown}
        href={href}
        spark={spark}
        sparkColor={sparkColor}
        size={size}
        className={className}
      />
    );
  }

  const s = METRIC_SIZES[size];
  const body = (
    <CardContent className={s.pad}>
      <MetricIconChip icon={icon} />
      <p className={cn("font-heading font-semibold tracking-tight tabular-nums", s.num, icon && "mt-3")}>
        <CountUp value={value} />
      </p>
      {sub ? (
        <p className="mt-1 text-sm font-medium text-emerald-600 tabular-nums dark:text-emerald-400">
          {sub}
        </p>
      ) : null}
      <p className={cn("text-sm font-medium text-muted-foreground", sub ? "mt-0.5" : "mt-1")}>
        {label}
      </p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
      {spark && spark.length > 1 ? (
        <Sparkline data={spark} color={sparkColor} className={cn("w-full", s.spark)} />
      ) : null}
    </CardContent>
  );

  if (href) {
    return (
      <Card
        className={cn(
          "fd-lift overflow-hidden hover:border-primary/40 hover:bg-muted/40",
          "focus-within:ring-2 focus-within:ring-ring",
          className,
        )}
      >
        <Link href={href} className="block outline-none">
          {body}
        </Link>
      </Card>
    );
  }

  return <Card className={cn("overflow-hidden", className)}>{body}</Card>;
}
