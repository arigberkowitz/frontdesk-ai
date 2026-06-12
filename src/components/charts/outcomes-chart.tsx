"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { CHART_COLORS, TOOLTIP_STYLE } from "./theme";

/** Friendly label + color for each call outcome (shared palette). */
const OUTCOME_META: Record<string, { label: string; color: string }> = {
  booked: { label: "Booked an appointment", color: CHART_COLORS.booked },
  lead: { label: "Took a message", color: CHART_COLORS.message },
  faq_answered: { label: "Answered a question", color: CHART_COLORS.answered },
  escalated: { label: "Transferred to a person", color: "#f59e0b" },
  missed: { label: "Missed", color: CHART_COLORS.missed },
  unknown: { label: "Other", color: CHART_COLORS.other },
};

/** Donut of what happened on calls, with the total in the center and a counted legend. */
export function OutcomesChart({ data }: { data: { outcome: string; count: number }[] }) {
  const rows = data
    .filter((d) => d.count > 0)
    .map((d) => ({
      key: d.outcome,
      value: d.count,
      ...(OUTCOME_META[d.outcome] ?? OUTCOME_META.unknown),
    }))
    .sort((a, b) => b.value - a.value);
  const total = rows.reduce((sum, r) => sum + r.value, 0);

  if (total === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        No calls yet — this fills in once your AI starts answering.
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:gap-8">
      <div className="relative h-56 w-56 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={rows}
              dataKey="value"
              nameKey="label"
              innerRadius={64}
              outerRadius={90}
              paddingAngle={rows.length > 1 ? 2 : 0}
              stroke="none"
            >
              {rows.map((r) => (
                <Cell key={r.key} fill={r.color} />
              ))}
            </Pie>
            <Tooltip contentStyle={{ ...TOOLTIP_STYLE }} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-3xl font-semibold tabular-nums">{total}</span>
          <span className="text-xs text-muted-foreground">calls</span>
        </div>
      </div>

      <ul className="w-full space-y-2.5">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2.5">
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: r.color }} />
              {r.label}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {r.value} · {Math.round((r.value / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
