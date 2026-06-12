"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DayPoint } from "@/lib/data/metrics";
import { CHART_AXIS, CHART_COLORS, CHART_GRID, TOOLTIP_STYLE } from "./theme";

function fmtDay(d: string): string {
  return new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="size-2.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />
      {label}
    </span>
  );
}

/** Calls + bookings over the last 14 days. */
export function CallsChart({ data }: { data: DayPoint[] }) {
  const hasData = data.some((d) => d.calls > 0 || d.bookings > 0);

  return (
    <div>
      <div className="mb-3 flex items-center gap-4 text-xs text-muted-foreground">
        <LegendDot color={CHART_COLORS.calls} label="Calls" />
        <LegendDot color={CHART_COLORS.bookings} label="Bookings" />
      </div>
      <div className="h-56 w-full">
        {!hasData ? (
          <div className="flex h-full items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
            No call activity in the last 14 days yet.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="calls-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHART_COLORS.calls} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={CHART_COLORS.calls} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="4 4" stroke={CHART_GRID} vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={fmtDay}
                tickLine={false}
                axisLine={false}
                fontSize={11}
                minTickGap={24}
                stroke={CHART_AXIS}
              />
              <YAxis
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                fontSize={11}
                width={26}
                stroke={CHART_AXIS}
              />
              <Tooltip labelFormatter={(d) => fmtDay(String(d))} contentStyle={{ ...TOOLTIP_STYLE }} />
              <Area
                type="monotone"
                dataKey="calls"
                name="Calls"
                stroke={CHART_COLORS.calls}
                strokeWidth={2.5}
                fill="url(#calls-fill)"
                activeDot={{ r: 4, strokeWidth: 0 }}
              />
              <Area
                type="monotone"
                dataKey="bookings"
                name="Bookings"
                stroke={CHART_COLORS.bookings}
                strokeWidth={2.5}
                fill="transparent"
                activeDot={{ r: 4, strokeWidth: 0 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
