"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isAfter,
  isBefore,
  isSameDay,
  isSameMonth,
  parse,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const DOW = ["S", "M", "T", "W", "T", "F", "S"];
const KEY = "yyyy-MM-dd";

/**
 * Pick one day or a range, with optional exact hours.
 *
 * These are wall-clock CALENDAR dates, not instants — "closed Dec 24–26" means
 * those dates at the shop, wherever the person setting it happens to be. The
 * server turns them into real instants using the business's timezone, so this
 * component deliberately stays in plain local date arithmetic and never tries
 * to do zone conversion itself.
 *
 * Emits hidden inputs the existing server action already understands:
 * startDate / endDate (yyyy-MM-dd) and startTimeOneOff / endTimeOneOff (HH:mm).
 */
export function DateRangePicker({
  startName = "startDate",
  endName = "endDate",
  startTimeName = "startTimeOneOff",
  endTimeName = "endTimeOneOff",
}: {
  startName?: string;
  endName?: string;
  startTimeName?: string;
  endTimeName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [from, setFrom] = useState<Date | null>(null);
  const [to, setTo] = useState<Date | null>(null);
  const [allDay, setAllDay] = useState(true);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape — a calendar that traps you is worse than none.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const days = useMemo(
    () =>
      eachDayOfInterval({
        start: startOfWeek(startOfMonth(month)),
        end: endOfWeek(endOfMonth(month)),
      }),
    [month],
  );

  function pick(day: Date) {
    const d = startOfDay(day);
    // First click sets the start. Second extends to a range — unless it lands
    // before the start, which reads as "actually, start here instead".
    if (!from || (from && to)) {
      setFrom(d);
      setTo(null);
      return;
    }
    if (isBefore(d, from)) {
      setFrom(d);
      return;
    }
    setTo(d);
  }

  const label = from
    ? to && !isSameDay(from, to)
      ? `${format(from, "MMM d")} – ${format(to, "MMM d, yyyy")}`
      : format(from, "EEE, MMM d, yyyy")
    : "Pick a date or range";

  const inRange = (d: Date) =>
    Boolean(from && to && isAfter(d, from) && isBefore(d, to));
  const isEdge = (d: Date) =>
    Boolean((from && isSameDay(d, from)) || (to && isSameDay(d, to)));

  return (
    <div className="space-y-3" ref={wrapRef}>
      {/* What the server action reads. Kept in sync with the visual state. */}
      <input type="hidden" name={startName} value={from ? format(from, KEY) : ""} />
      <input type="hidden" name={endName} value={format(to ?? from ?? new Date(0), KEY)} />
      <input type="hidden" name={startTimeName} value={allDay ? "" : startTime} />
      <input type="hidden" name={endTimeName} value={allDay ? "" : endTime} />

      <div className="relative">
        <Button
          type="button"
          variant="outline"
          className="w-full justify-start font-normal"
          onClick={() => setOpen((v) => !v)}
        >
          <CalendarDays className="size-4" />
          {label}
        </Button>

        {open ? (
          <div className="absolute left-0 top-full z-50 mt-2 w-72 rounded-xl border bg-popover p-3 shadow-lg">
            <div className="mb-2 flex items-center justify-between">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Previous month"
                onClick={() => setMonth((m) => subMonths(m, 1))}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <span className="text-sm font-medium">{format(month, "MMMM yyyy")}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Next month"
                onClick={() => setMonth((m) => addMonths(m, 1))}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>

            <div className="grid grid-cols-7 text-center text-[11px] text-muted-foreground">
              {DOW.map((d, i) => (
                <div key={i} className="py-1">
                  {d}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-0.5">
              {days.map((day) => {
                const outside = !isSameMonth(day, month);
                return (
                  <button
                    key={day.toISOString()}
                    type="button"
                    onClick={() => pick(day)}
                    className={cn(
                      "h-8 rounded-md text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                      outside && "text-muted-foreground/40",
                      isEdge(day)
                        ? "bg-primary font-semibold text-primary-foreground"
                        : inRange(day)
                          ? "bg-primary/15 text-foreground"
                          : "hover:bg-muted",
                    )}
                  >
                    {format(day, "d")}
                  </button>
                );
              })}
            </div>

            <p className="mt-2 text-[11px] text-muted-foreground">
              {from && !to
                ? "Pick an end date, or the same day again for one day."
                : "Click a day, then another for a range."}
            </p>

            <div className="mt-2 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFrom(null);
                  setTo(null);
                }}
              >
                Clear
              </Button>
              <Button type="button" size="sm" onClick={() => setOpen(false)}>
                Done
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={allDay}
          onChange={(e) => setAllDay(e.target.checked)}
          className="size-4 rounded border-input"
        />
        Closed the whole day
      </label>

      {!allDay ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <span className="text-sm font-medium">From</span>
            <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <span className="text-sm font-medium">To</span>
            <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Parse a yyyy-MM-dd back to a Date (local), for callers that need it. */
export function parseDayKey(key: string): Date {
  return parse(key, KEY, new Date());
}
