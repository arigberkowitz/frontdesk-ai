"use client";

import { startTransition, useActionState, useMemo, useRef, useState } from "react";
import { CalendarRange, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import {
  addAvailabilityBlockAction,
  deleteAvailabilityBlockAction,
} from "@/lib/actions/availability-blocks";
import { initialActionState, type ActionState } from "@/lib/actions/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/form/native-select";
import { DAYS } from "@/config/options";
import {
  blocksForDay,
  clockLabel,
  gridWindow,
  placement,
  selectionRange,
  SLOT_MIN,
  toMinutes,
  type DayHours,
  type RecurringBlock,
} from "@/lib/week-grid";
import { cn } from "@/lib/utils";

type Selection = { day: number; rowA: number; rowB: number };

/**
 * The week at a glance, and the mouse as the way to say "not then".
 *
 * Open hours are the light columns, closed time is shaded, and every
 * recurring break sits where it happens. Drag down a day to draw a new
 * block, name it, done — no day/from/to form. Click a block to remove it.
 * One-off closures (dated) live in the list below; this grid is the weekly
 * rhythm.
 */
export function WeekGrid({
  clientId,
  hours,
  blocks,
  providers,
  canEdit,
}: {
  clientId: string;
  hours: DayHours[];
  blocks: RecurringBlock[];
  providers: Array<{ id: string; name: string }>;
  canEdit: boolean;
}) {
  const window_ = useMemo(() => gridWindow(hours), [hours]);
  const rows = (window_.endMin - window_.startMin) / SLOT_MIN;
  const hourMarks = useMemo(() => {
    const out: number[] = [];
    for (let m = window_.startMin; m < window_.endMin; m += 60) out.push(m);
    return out;
  }, [window_]);
  const byDay = useMemo(() => new Map(hours.map((h) => [h.dayOfWeek, h])), [hours]);

  const [sel, setSel] = useState<Selection | null>(null);
  const [dragging, setDragging] = useState(false);
  const [picked, setPicked] = useState<RecurringBlock | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const [, addAction, adding] = useActionState(
    async (prev: ActionState, fd: FormData) => {
      const next = await addAvailabilityBlockAction(prev, fd);
      if (next.ok) {
        toast.success(next.message ?? "Added.");
        setSel(null);
      } else {
        toast.error(next.error ?? Object.values(next.fieldErrors ?? {})[0]?.[0] ?? "Couldn't add that.");
      }
      return next;
    },
    initialActionState,
  );
  const [, deleteAction, deleting] = useActionState(
    async (prev: ActionState, fd: FormData) => {
      const next = await deleteAvailabilityBlockAction(prev, fd);
      if (next.ok) {
        toast.success(next.message ?? "Removed.");
        setPicked(null);
      } else toast.error(next.error ?? "Couldn't remove that.");
      return next;
    },
    initialActionState,
  );

  /** Which slot row a pointer is over inside a day column. */
  function rowAt(e: React.PointerEvent, col: HTMLElement): number {
    const rect = col.getBoundingClientRect();
    const y = Math.min(rect.height - 1, Math.max(0, e.clientY - rect.top));
    return Math.min(rows - 1, Math.floor((y / rect.height) * rows));
  }

  function onDown(day: number, e: React.PointerEvent<HTMLDivElement>) {
    if (!canEdit || e.button !== 0) return;
    // A click on an existing block picks it; the block stops propagation.
    const row = rowAt(e, e.currentTarget);
    setPicked(null);
    setSel({ day, rowA: row, rowB: row });
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging || !sel) return;
    const row = rowAt(e, e.currentTarget);
    if (row !== sel.rowB) setSel({ ...sel, rowB: row });
  }
  function onUp() {
    setDragging(false);
  }

  const selRange = sel ? selectionRange(window_.startMin, sel.rowA, sel.rowB) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarRange className="size-4 text-muted-foreground" />
          Your week
        </CardTitle>
        <CardDescription>
          {canEdit
            ? "Drag down a day to block off time your AI shouldn't book — lunch, a standing meeting, the school run. Click a block to remove it."
            : "When your AI can and can't book, at a glance."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div
          ref={gridRef}
          className="grid select-none overflow-hidden rounded-lg border text-xs"
          style={{ gridTemplateColumns: "3.25rem repeat(7, minmax(0, 1fr))" }}
        >
          {/* Header row */}
          <div className="border-b bg-muted/40" />
          {DAYS.map((d) => {
            const h = byDay.get(d.value);
            const open = h && !h.isClosed && h.openTime && h.closeTime;
            return (
              <div key={d.value} className="border-b border-l bg-muted/40 px-1 py-1.5 text-center">
                <div className="font-medium">{d.short}</div>
                <div className="truncate text-[10px] text-muted-foreground">
                  {open ? `${clockLabel(toMinutes(h.openTime!))}–${clockLabel(toMinutes(h.closeTime!))}` : "Closed"}
                </div>
              </div>
            );
          })}

          {/* Time gutter */}
          <div className="relative" style={{ height: `${rows * 1.1}rem` }}>
            {hourMarks.map((m) => (
              <div
                key={m}
                className="absolute right-1 -translate-y-1/2 text-[10px] tabular-nums text-muted-foreground"
                style={{ top: `${((m - window_.startMin) / (window_.endMin - window_.startMin)) * 100}%` }}
              >
                {m === window_.startMin ? "" : clockLabel(m)}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {DAYS.map((d) => {
            const h = byDay.get(d.value);
            const isOpen = Boolean(h && !h.isClosed && h.openTime && h.closeTime);
            const openPlace = isOpen ? placement(window_, h!.openTime!, h!.closeTime!) : null;
            const dayBlocks = blocksForDay(blocks, d.value);
            const isSelDay = sel?.day === d.value;
            const selPlace = isSelDay && selRange ? placement(window_, selRange.startTime, selRange.endTime) : null;
            return (
              <div
                key={d.value}
                className={cn(
                  "relative border-l bg-muted/30 touch-none",
                  canEdit && "cursor-crosshair",
                )}
                style={{ height: `${rows * 1.1}rem` }}
                onPointerDown={(e) => onDown(d.value, e)}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
                role={canEdit ? "button" : undefined}
                aria-label={canEdit ? `Drag to block time on ${d.label}` : undefined}
              >
                {/* Open window: the light part of the column */}
                {openPlace ? (
                  <div
                    className="absolute inset-x-0 bg-background"
                    style={{ top: `${openPlace.topPct}%`, height: `${openPlace.heightPct}%` }}
                  />
                ) : null}
                {/* Hour lines */}
                {hourMarks.map((m) => (
                  <div
                    key={m}
                    className="pointer-events-none absolute inset-x-0 border-t border-border/60"
                    style={{ top: `${((m - window_.startMin) / (window_.endMin - window_.startMin)) * 100}%` }}
                  />
                ))}
                {/* Blocks */}
                {dayBlocks.map((b) => {
                  const p = placement(window_, b.startTime, b.endTime);
                  if (!p) return null;
                  const isPicked = picked?.id === b.id;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!canEdit) return;
                        setSel(null);
                        setPicked(isPicked ? null : b);
                      }}
                      title={`${b.label}${b.providerName ? ` · ${b.providerName}` : ""} · ${clockLabel(toMinutes(b.startTime))}–${clockLabel(toMinutes(b.endTime))}${b.dayOfWeek === null ? " · every day" : ""}`}
                      className={cn(
                        "absolute inset-x-0.5 overflow-hidden rounded-md border px-1 py-0.5 text-left text-[10px] leading-tight",
                        b.dayOfWeek === null
                          ? "border-amber-500/40 bg-amber-500/20 text-amber-900 dark:text-amber-200"
                          : "border-indigo-500/40 bg-indigo-500/20 text-indigo-900 dark:text-indigo-200",
                        isPicked && "ring-2 ring-ring",
                        canEdit ? "cursor-pointer hover:brightness-95" : "cursor-default",
                      )}
                      style={{ top: `${p.topPct}%`, height: `${p.heightPct}%` }}
                    >
                      <span className="block truncate font-medium">{b.label}</span>
                      {p.heightPct > 7 ? (
                        <span className="block truncate opacity-80">
                          {b.providerName ?? (b.dayOfWeek === null ? "Every day" : "")}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
                {/* Drag selection */}
                {selPlace ? (
                  <div
                    className="pointer-events-none absolute inset-x-0.5 rounded-md border-2 border-dashed border-primary bg-primary/15"
                    style={{ top: `${selPlace.topPct}%`, height: `${selPlace.heightPct}%` }}
                  />
                ) : null}
              </div>
            );
          })}
        </div>

        {/* Floating editor for the selection or the picked block */}
        {sel && selRange && !dragging ? (
          <form
            className="mt-3 flex flex-col gap-2 rounded-lg border bg-muted/40 p-3 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              fd.set("clientId", clientId);
              fd.set("kind", "recurring");
              fd.set("dayOfWeek", String(sel.day));
              fd.set("startTime", selRange.startTime);
              fd.set("endTime", selRange.endTime);
              startTransition(() => addAction(fd));
            }}
          >
            <div className="min-w-0 flex-1">
              <p className="mb-1 text-xs text-muted-foreground">
                Block {DAYS[sel.day].label}s, {clockLabel(toMinutes(selRange.startTime))}–
                {clockLabel(toMinutes(selRange.endTime))}
              </p>
              <Input name="label" placeholder="What is it? (Lunch)" required maxLength={80} autoFocus />
            </div>
            {providers.length ? (
              <NativeSelect name="providerId" defaultValue="" className="h-8 sm:w-44">
                <option value="">Whole business</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} only
                  </option>
                ))}
              </NativeSelect>
            ) : null}
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={adding}>
                {adding ? "Adding…" : "Block it"}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setSel(null)}>
                <X className="size-3.5" />
              </Button>
            </div>
          </form>
        ) : null}

        {picked ? (
          <div className="mt-3 flex flex-col gap-2 rounded-lg border bg-muted/40 p-3 sm:flex-row sm:items-center">
            <p className="min-w-0 flex-1 text-sm">
              <span className="font-medium">{picked.label}</span>
              <span className="text-muted-foreground">
                {" "}
                · {picked.dayOfWeek === null ? "every day" : `${DAYS[picked.dayOfWeek].label}s`},{" "}
                {clockLabel(toMinutes(picked.startTime))}–{clockLabel(toMinutes(picked.endTime))}
                {picked.providerName ? ` · ${picked.providerName}` : ""}
              </span>
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="destructive"
                disabled={deleting}
                onClick={() => {
                  const fd = new FormData();
                  fd.set("clientId", clientId);
                  fd.set("blockId", picked.id);
                  startTransition(() => deleteAction(fd));
                }}
              >
                <Trash2 className="size-3.5" />
                {deleting ? "Removing…" : "Remove"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPicked(null)}>
                <X className="size-3.5" />
              </Button>
            </div>
          </div>
        ) : null}

        <p className="mt-3 text-xs text-muted-foreground">
          Shaded is closed. <span className="rounded bg-indigo-500/20 px-1">Blue</span> blocks are one
          day a week; <span className="rounded bg-amber-500/20 px-1">amber</span> ones repeat every day.
        </p>
      </CardContent>
    </Card>
  );
}
