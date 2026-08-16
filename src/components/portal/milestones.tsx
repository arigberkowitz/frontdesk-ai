import { Trophy } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PanelHeader } from "@/components/panel-header";
import { formatCurrencyCents } from "@/lib/format";

/**
 * Retention: milestone progress. Celebrates real accomplishments and shows the
 * next target — a reason to come back that never lies about the numbers.
 */
const CALL_STEPS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000];
const REVENUE_STEPS = [
  10_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 2_500_000, 5_000_000,
];

function tier(value: number, steps: number[]): { achieved: number | null; next: number | null } {
  let achieved: number | null = null;
  for (const s of steps) {
    if (value >= s) achieved = s;
    else return { achieved, next: s };
  }
  return { achieved, next: null };
}

export function Milestones({
  totalCalls,
  estRevenueCents,
}: {
  totalCalls: number;
  estRevenueCents: number;
}) {
  const calls = tier(totalCalls, CALL_STEPS);
  const revenue = tier(estRevenueCents, REVENUE_STEPS);
  if (totalCalls === 0 && estRevenueCents === 0) return null;

  const rows = [
    {
      label: "Calls answered",
      valueText: String(totalCalls),
      achieved: calls.achieved ? `${calls.achieved} club` : null,
      next: calls.next ? `next: ${calls.next}` : "top tier!",
      pct: calls.next ? Math.min(100, Math.round((totalCalls / calls.next) * 100)) : 100,
      bar: "bg-sky-500",
    },
    {
      label: "Revenue captured",
      valueText: formatCurrencyCents(estRevenueCents),
      achieved: revenue.achieved ? `${formatCurrencyCents(revenue.achieved)} club` : null,
      next: revenue.next ? `next: ${formatCurrencyCents(revenue.next)}` : "top tier!",
      pct: revenue.next
        ? Math.min(100, Math.round((estRevenueCents / revenue.next) * 100))
        : 100,
      bar: "bg-emerald-500",
    },
  ];

  return (
    <Card>
      <CardContent className="p-5 sm:p-6">
        <PanelHeader
          icon={Trophy}
          title="Milestones"
          description="Every number here is real — earned by calls your AI actually answered."
        />
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {rows.map((r) => (
            <div key={r.label}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{r.label}</span>
                <span className="font-heading text-lg font-semibold tabular-nums">
                  {r.valueText}
                </span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full ${r.bar} transition-all`}
                  style={{ width: `${r.pct}%` }}
                />
              </div>
              <div className="mt-1 flex justify-between text-xs text-muted-foreground">
                <span>
                  {r.achieved ? (
                    <span className="font-medium text-amber-600 dark:text-amber-400">
                      {r.achieved}
                    </span>
                  ) : (
                    "first milestone ahead"
                  )}
                </span>
                <span>{r.next}</span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
