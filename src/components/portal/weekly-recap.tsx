import { ArrowUpRight, CalendarDays } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { CountUp } from "@/components/count-up";
import { formatCurrencyCents } from "@/lib/format";
import type { WeeklyRecap as Recap } from "@/lib/data/metrics";

/** A delta line: "+3", "+$500", or "same as last week" — green only when up. */
function Delta({ value, money }: { value: number; money?: boolean }) {
  if (value === 0) {
    return <span className="text-xs text-muted-foreground">same as last week</span>;
  }
  const up = value > 0;
  const text = money
    ? `${up ? "+" : "−"}${formatCurrencyCents(Math.abs(value))}`
    : `${up ? "+" : "−"}${Math.abs(value)}`;
  return (
    <span
      className={
        up ? "inline-flex items-center gap-0.5 text-xs text-emerald-600 dark:text-emerald-400" : "text-xs text-muted-foreground"
      }
    >
      {up ? <ArrowUpRight className="size-3" /> : null}
      {text}
    </span>
  );
}

function Cell({ value, label, delta, money }: { value: string; label: string; delta: number; money?: boolean }) {
  return (
    <div>
      <p className="font-heading text-2xl font-semibold leading-none tabular-nums">
        <CountUp value={value} />
      </p>
      <p className="mb-0.5 mt-1.5 text-xs text-muted-foreground">{label}</p>
      <Delta value={delta} money={money} />
    </div>
  );
}

/** "This week" recap with week-over-week change. */
export function WeeklyRecap({ recap }: { recap: Recap }) {
  return (
    <Card>
      <CardContent className="p-5 sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <CalendarDays className="size-4" />
            This week
          </span>
          <span className="text-xs text-muted-foreground">vs. last week</span>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
          <Cell value={String(recap.calls)} label="Calls answered" delta={recap.callsDelta} />
          <Cell value={String(recap.bookings)} label="Appointments" delta={recap.bookingsDelta} />
          <Cell
            value={formatCurrencyCents(recap.valueCents)}
            label="Booked value"
            delta={recap.valueDeltaCents}
            money
          />
          <Cell value={String(recap.afterHours)} label="After-hours saves" delta={recap.afterHoursDelta} />
        </div>
      </CardContent>
    </Card>
  );
}
