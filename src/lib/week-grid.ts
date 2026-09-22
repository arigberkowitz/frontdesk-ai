/**
 * Geometry for the drag-to-block week grid. Pure, so the slot math and the
 * "which rows is this business open" logic are testable without a browser.
 */

export const SLOT_MIN = 30;

export interface DayHours {
  dayOfWeek: number;
  openTime: string | null;
  closeTime: string | null;
  isClosed: boolean;
}

export interface RecurringBlock {
  id: string;
  label: string;
  /** null = every day */
  dayOfWeek: number | null;
  startTime: string;
  endTime: string;
  providerName: string | null;
}

/** "13:30" → 810 */
export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

/** 810 → "13:30" */
export function toHHMM(minutes: number): string {
  const m = Math.max(0, Math.min(24 * 60, minutes));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** 810 → "1:30 PM"; 780 → "1 PM" */
export function clockLabel(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const h12 = h24 % 12 || 12;
  const ampm = h24 < 12 ? "AM" : "PM";
  return m ? `${h12}:${String(m).padStart(2, "0")} ${ampm}` : `${h12} ${ampm}`;
}

/**
 * The window the grid draws: an hour of margin either side of the earliest
 * open and latest close, on whole hours, clamped to 6 AM–10 PM. A business
 * with no hours yet gets 8–6 so the grid still means something.
 */
export function gridWindow(hours: DayHours[]): { startMin: number; endMin: number } {
  const open = hours.filter((h) => !h.isClosed && h.openTime && h.closeTime);
  if (!open.length) return { startMin: 8 * 60, endMin: 18 * 60 };
  const earliest = Math.min(...open.map((h) => toMinutes(h.openTime!)));
  const latest = Math.max(...open.map((h) => toMinutes(h.closeTime!)));
  const startMin = Math.max(6 * 60, Math.floor(earliest / 60) * 60 - 60);
  const endMin = Math.min(22 * 60, Math.ceil(latest / 60) * 60 + 60);
  return { startMin, endMin: Math.max(endMin, startMin + 4 * 60) };
}

/** Snap a pointer's row index to a [start, end) minute range, always ≥ one slot. */
export function selectionRange(
  startMin: number,
  rowA: number,
  rowB: number,
): { startTime: string; endTime: string } {
  const lo = Math.min(rowA, rowB);
  const hi = Math.max(rowA, rowB);
  return {
    startTime: toHHMM(startMin + lo * SLOT_MIN),
    endTime: toHHMM(startMin + (hi + 1) * SLOT_MIN),
  };
}

/** Top/height of a time range as percentages of the grid window. */
export function placement(
  window: { startMin: number; endMin: number },
  startTime: string,
  endTime: string,
): { topPct: number; heightPct: number } | null {
  const span = window.endMin - window.startMin;
  const s = Math.max(window.startMin, toMinutes(startTime));
  const e = Math.min(window.endMin, toMinutes(endTime));
  if (e <= s) return null;
  return { topPct: ((s - window.startMin) / span) * 100, heightPct: ((e - s) / span) * 100 };
}

/** Blocks that apply to a given weekday: its own plus the every-day ones. */
export function blocksForDay(blocks: RecurringBlock[], dayOfWeek: number): RecurringBlock[] {
  return blocks.filter((b) => b.dayOfWeek === null || b.dayOfWeek === dayOfWeek);
}
