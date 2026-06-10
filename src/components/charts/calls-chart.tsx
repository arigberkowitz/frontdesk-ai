"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DayPoint } from "@/lib/data/metrics";

function fmtDay(d: string): string {
  return new Date(`${d}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/** Calls + bookings over the last 14 days. */
export function CallsChart({ data }: { data: DayPoint[] }) {
  const hasData = data.some((d) => d.calls > 0 || d.bookings > 0);

  return (
    <div className="h-64 w-full">
      {!hasData ? (
        <div className="flex h-full items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
          No call activity in the last 14 days yet.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
            <defs>
              <linearGradient id="calls-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6366f1" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={fmtDay}
              tickLine={false}
              axisLine={false}
              fontSize={11}
              minTickGap={24}
              stroke="var(--muted-foreground)"
            />
            <YAxis
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              fontSize={11}
              width={28}
              stroke="var(--muted-foreground)"
            />
            <Tooltip
              labelFormatter={(d) => fmtDay(String(d))}
              contentStyle={{
                borderRadius: 10,
                border: "1px solid var(--border)",
                fontSize: 12,
                boxShadow: "0 4px 12px rgb(0 0 0 / 0.08)",
              }}
            />
            <Legend
              verticalAlign="top"
              align="right"
              height={28}
              iconType="plainline"
              wrapperStyle={{ fontSize: 12 }}
            />
            <Area
              type="monotone"
              dataKey="calls"
              name="Calls"
              stroke="#6366f1"
              strokeWidth={2}
              fill="url(#calls-fill)"
            />
            <Area
              type="monotone"
              dataKey="bookings"
              name="Bookings"
              stroke="#10b981"
              strokeWidth={2}
              fill="transparent"
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
