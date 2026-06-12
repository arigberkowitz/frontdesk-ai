import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { MetricBreakdown } from "@/components/metric-breakdown";

interface MetricCardProps {
  label: string;
  value: string;
  hint?: string;
  icon?: LucideIcon;
  /** When set, the card links to the underlying records. */
  href?: string;
  /** When set, clicking the card expands these fact lines (the breakdown). */
  breakdown?: string[];
  className?: string;
}

/** Big, legible stat. Optionally links to the records, or expands a breakdown on click. */
export function MetricCard({ label, value, hint, icon: Icon, href, breakdown, className }: MetricCardProps) {
  // The expandable variant is a client island that takes only strings (no icon),
  // so MetricCard itself stays a shared component and can render the icon safely.
  if (breakdown && breakdown.length > 0) {
    return (
      <MetricBreakdown
        label={label}
        value={value}
        hint={hint}
        breakdown={breakdown}
        href={href}
        className={className}
      />
    );
  }

  const body = (
    <CardContent className="p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        {Icon ? <Icon className="size-4 shrink-0 text-muted-foreground" /> : null}
      </div>
      <p className="mt-2 font-heading text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </CardContent>
  );

  if (href) {
    return (
      <Card
        className={cn(
          "overflow-hidden transition-colors hover:border-primary/40 hover:bg-muted/40",
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
