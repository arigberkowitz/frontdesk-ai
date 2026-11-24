/**
 * The "while you were closed" lines — pure, so the weekly email, the portal
 * and the tests all say exactly the same thing. Real counts only. The one
 * money line (afterHoursValueLine) uses the owner's own listed prices and
 * nothing else — no averages, no defaults, no estimates.
 */
import { formatCurrencyCents } from "./format";

export interface AfterHoursWeek {
  /** After-hours calls the AI answered in the last 7 days (no spam, no missed). */
  answered: number;
  /** Of those, how many ended with an appointment on the calendar. */
  booked: number;
  /** Of the rest, how many left a message / callback request. */
  messages: number;
  /** The 7 days before that, for one comparison line. */
  prior: { answered: number; booked: number };
  /**
   * What the booked calls are worth at the owner's listed prices. Absent on
   * older callers; `priced` = booked calls where every live appointment's
   * service has an owner-set price (services.price_cents not null).
   */
  value?: AfterHoursValue | null;
}

export interface AfterHoursValue {
  /** How many of `booked` had a listed price on every appointment. */
  priced: number;
  /** Sum of services.price_cents over those priced bookings only. */
  cents: number;
  /** Some counted price is a "from $X" floor or the low end of a range. */
  atLeast: boolean;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * "While you were closed this week, your AI answered 7 calls and booked 3 of
 * them. It took a message on 2 more."
 */
export function afterHoursHeadline(w: AfterHoursWeek): string {
  if (w.answered === 0) return "No calls came in while you were closed this week.";
  const calls = plural(w.answered, "call", "calls");
  let s: string;
  if (w.booked > 0) {
    const ofThem = w.booked === w.answered ? (w.answered === 1 ? "it" : "all of them") : `${w.booked} of them`;
    s = `While you were closed this week, your AI answered ${calls} and booked ${ofThem}.`;
  } else {
    s = `While you were closed this week, your AI answered ${calls}.`;
  }
  if (w.messages > 0) {
    if (w.booked > 0) s += ` It took a message on ${w.messages} more.`;
    else if (w.messages === w.answered) s += w.answered === 1 ? " It took a message." : " It took a message on each one.";
    else s += ` It took a message on ${w.messages} of them.`;
  }
  return s;
}

/** "Last week: 4 calls, 1 booked." — null when there's nothing to compare. */
export function afterHoursComparison(w: AfterHoursWeek): string | null {
  const p = w.prior;
  if (p.answered === 0 && w.answered === 0) return null;
  if (p.answered === 0) return "The week before, none came in after hours.";
  return `The week before: ${plural(p.answered, "after-hours call", "after-hours calls")}, ${p.booked} booked.`;
}

/**
 * "Those 3 bookings are worth about $420 at your listed prices." Only from
 * bookings whose service has a price the owner set. Some unpriced: says how
 * many had a price. None priced (or nothing booked): null — leave it out.
 */
export function afterHoursValueLine(w: AfterHoursWeek): string | null {
  const v = w.value;
  if (!v || w.booked <= 0 || v.priced <= 0 || v.cents <= 0) return null;
  const priced = Math.min(v.priced, w.booked);
  const worth = `${v.atLeast ? "at least" : "about"} ${formatCurrencyCents(v.cents)}`;
  if (priced === w.booked) {
    return w.booked === 1
      ? `That booking is worth ${worth} at your listed prices.`
      : `Those ${w.booked} bookings are worth ${worth} at your listed prices.`;
  }
  return `${priced} of ${w.booked} bookings had a listed price, worth ${worth}.`;
}
