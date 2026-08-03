/**
 * Is this exact slot bookable at all?
 *
 * Availability generation answers "what times can I offer?"; this answers "may
 * I take THIS time?", which is a different question and used to go unasked. The
 * booking tool checked only whether another appointment overlapped, so a caller
 * who named a time — "can you do Sunday at 6?" — got it, on a day the business
 * is closed, or in the middle of the lunch hour the owner had blocked out.
 * Google's free/busy can't catch that: an empty calendar at 3 AM looks free.
 *
 * Pure and client-safe, so it can be tested without a database and reused by
 * both the slot grid and the booking path — the two must agree.
 */
import { wallClockToInstant, zoneOffsetMs } from "./hours-util";

export interface BusinessHourLite {
  dayOfWeek: number;
  isClosed: boolean;
  openTime: string | null;
  closeTime: string | null;
}

/**
 * A window the business — or one specific person — is unavailable for.
 * `providerId` set means it's that person's leave, NOT a closure of the whole
 * business. Treating the two alike shut the shop every time one hygienist took
 * a Friday off.
 */
export interface AvailabilityBlockLite {
  providerId?: string | null;
  dayOfWeek?: number | null;
  startTime?: string | null;
  endTime?: string | null;
  startsAt?: Date | string | null;
  endsAt?: Date | string | null;
}

/** Blocks that close the business for everyone. */
export function businessWideBlocks<T extends AvailabilityBlockLite>(blocks: T[]): T[] {
  return blocks.filter((b) => !b.providerId);
}

/** Blocks that apply to one person: their own leave, plus any full closure. */
export function blocksForProvider<T extends AvailabilityBlockLite>(
  blocks: T[],
  providerId: string,
): T[] {
  return blocks.filter((b) => !b.providerId || b.providerId === providerId);
}

/** The local calendar date + weekday of an instant, in `tz`. */
export function localDayParts(ms: number, tz: string): { y: number; mo: number; dd: number; dow: number } {
  const p: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(new Date(ms)))
    if (part.type !== "literal") p[part.type] = part.value;
  return {
    y: Number(p.year),
    mo: Number(p.month) - 1,
    dd: Number(p.day),
    dow: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday),
  };
}

/** Absolute [start,end) windows a set of blocks covers inside one local day. */
export function blockWindowsForDay(
  blocks: AvailabilityBlockLite[],
  tz: string,
  y: number,
  mo: number,
  dd: number,
  dow: number,
): Array<readonly [number, number]> {
  const out: Array<readonly [number, number]> = [];
  for (const b of blocks) {
    if (b.startsAt && b.endsAt) {
      // One-off: already absolute, applies to whatever days it spans.
      out.push([new Date(b.startsAt).getTime(), new Date(b.endsAt).getTime()] as const);
      continue;
    }
    if (!b.startTime || !b.endTime) continue;
    // Recurring: null dayOfWeek means every day.
    if (b.dayOfWeek != null && b.dayOfWeek !== dow) continue;
    const [sh, sm] = b.startTime.split(":").map(Number);
    const [eh, em] = b.endTime.split(":").map(Number);
    if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) continue;
    out.push([
      wallClockToInstant(tz, y, mo, dd, sh, sm).getTime(),
      wallClockToInstant(tz, y, mo, dd, eh, em).getTime(),
    ] as const);
  }
  return out;
}

/** True when [startMs,endMs) touches any block, checking both local days it may span. */
export function overlapsBlock(
  blocks: AvailabilityBlockLite[],
  tz: string,
  startMs: number,
  endMs: number,
): boolean {
  if (!blocks.length) return false;
  // A slot can straddle midnight, and a recurring block belongs to a local day,
  // so gather windows for every day the slot touches — not just its start.
  const days = new Set([startMs, Math.max(startMs, endMs - 1)].map((ms) => JSON.stringify(localDayParts(ms, tz))));
  for (const key of days) {
    const { y, mo, dd, dow } = JSON.parse(key) as ReturnType<typeof localDayParts>;
    for (const [bs, be] of blockWindowsForDay(blocks, tz, y, mo, dd, dow)) {
      if (startMs < be && endMs > bs) return true;
    }
  }
  return false;
}

export type SlotVerdict =
  | "ok"
  | "no_hours" // the business never set opening hours — can't judge, don't guess
  | "closed" // that day is closed, or the time falls outside open–close
  | "blocked"; // lunch, a holiday, a closure the owner set

/**
 * May we book [startMs,endMs)? `blocks` should already be narrowed to the ones
 * that apply — business-wide for a shared calendar, or one person's for staff
 * mode (see `businessWideBlocks` / `blocksForProvider`).
 */
export function checkSlot(opts: {
  hours: BusinessHourLite[];
  blocks?: AvailabilityBlockLite[];
  tz: string;
  startMs: number;
  endMs: number;
}): SlotVerdict {
  const { hours, tz, startMs, endMs } = opts;
  const configured = hours.filter((h) => !h.isClosed && h.openTime && h.closeTime);
  // No hours anywhere means we have no opinion. Refusing here would block every
  // booking for a business that simply hasn't finished setup.
  if (configured.length === 0) return "no_hours";

  const { y, mo, dd, dow } = localDayParts(startMs, tz);
  const day = hours.find((h) => h.dayOfWeek === dow);
  if (!day || day.isClosed || !day.openTime || !day.closeTime) return "closed";

  const [oh, om] = day.openTime.split(":").map(Number);
  const [ch, cm] = day.closeTime.split(":").map(Number);
  if ([oh, om, ch, cm].some((n) => Number.isNaN(n))) return "no_hours";

  const open = wallClockToInstant(tz, y, mo, dd, oh, om).getTime();
  const close = wallClockToInstant(tz, y, mo, dd, ch, cm).getTime();
  // The appointment must fit entirely inside the day, not merely begin inside
  // it — a 60-minute slot starting ten minutes before closing does not fit.
  if (startMs < open || endMs > close) return "closed";

  if (overlapsBlock(opts.blocks ?? [], tz, startMs, endMs)) return "blocked";
  return "ok";
}

/** What the agent should say when a named time can't be taken. */
export function slotRefusal(verdict: Exclude<SlotVerdict, "ok" | "no_hours">): string {
  return verdict === "closed"
    ? "The business is closed at that time. Say so plainly, tell the caller the hours for that day, and offer a time inside them."
    : "That time is blocked off. Don't explain why — just say it isn't available and offer a different time.";
}

// Re-exported so callers doing their own arithmetic use the same offset rules.
export { zoneOffsetMs };
