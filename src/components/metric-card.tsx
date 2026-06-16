import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { MetricBreakdown } from "@/components/metric-breakdown";
import { MetricIconChip, type MetricIcon } from "@/components/metric-accent";

interface MetricCardProps {
  label: string;
  value: string;
  hint?: string;
  /** Leading accent icon-chip; binds to a fixed color in the registry. */
  icon?: MetricIcon;
  /** When set, the card links to the underlying records. */
  href?: string;
  /** When set, clicking the card expands these fact lines (the breakdown). */
  breakdown?: string[];
  className?: string;
}

/** Big, legible stat. Optionally links to the records, or expands a breakdown on click. */
export function MetricCard({ label, value, hint, icon, href, breakdown, className }: MetricCardProps) {
  if (breakdown && breakdown.length > 0) {
    return (
      <MetricBreakdown
        label={label}
        value={value}
        hint={hint}
        icon={icon}
        breakdown={breakdown}
        href={href}
        className={className}
      />
    );
  }

  const body = (
    <CardContent className="p-5">
      <MetricIconChip icon={icon} />
      <p className={cn("font-heading text-3xl font-semibold tracking-tight tabular-nums", icon && "mt-3")}>
        {value}
      </p>
      <p className="mt-1 text-sm font-medium text-muted-foreground">{label}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
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
