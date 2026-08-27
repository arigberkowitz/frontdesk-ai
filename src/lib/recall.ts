/**
 * Who is due back, and what we say to them.
 *
 * Pure, so the rules are testable without a database. Recall is the difference
 * between a product that answers the phone and one that fills next month: a
 * dental practice lives on six-month cleanings, a barber on four-week fades,
 * an HVAC company on twice-a-year service. All of that is knowable from the
 * appointment history we already keep, and none of it was being used.
 */

/**
 * Don't text on the exact due date — text a little before it, so the customer
 * books into a week that still has slots in it.
 */
export const RECALL_LEAD_DAYS = 7;

/**
 * How far past due we keep trying. Beyond this the customer has almost
 * certainly gone elsewhere, and a text nine months late is an admission that
 * nobody noticed they left.
 */
export const RECALL_MAX_OVERDUE_DAYS = 60;

/** One recall per customer per cycle, no matter how many services they've had. */
export const RECALL_MIN_DAYS_BETWEEN = 90;

export interface RecallCandidate {
  /** The most recent completed visit for this customer. */
  lastVisitAt: Date;
  /** The recall interval of the service they had, in days. Null = not a repeat service. */
  recallIntervalDays: number | null;
  status: string;
  customerPhone: string | null;
  /** True when this customer already has a future appointment on the books. */
  hasUpcoming: boolean;
  /** Last recall text sent to this number, if any. */
  lastRecalledAt?: Date | null;
}

/** The date this customer becomes due, given their last visit. */
export function dueDate(lastVisitAt: Date, recallIntervalDays: number): Date {
  return new Date(lastVisitAt.getTime() + recallIntervalDays * 86_400_000);
}

export function isDueForRecall(c: RecallCandidate, now: Date): boolean {
  if (!c.customerPhone?.trim()) return false;
  if (c.recallIntervalDays == null || c.recallIntervalDays <= 0) return false;
  if (c.status === "cancelled" || c.status === "no_show") return false;
  // Never chase somebody who is already coming back. This is the single most
  // embarrassing thing a recall system can do, and it is entirely avoidable.
  if (c.hasUpcoming) return false;
  if (c.lastVisitAt.getTime() > now.getTime()) return false;

  const due = dueDate(c.lastVisitAt, c.recallIntervalDays).getTime();
  const daysUntilDue = (due - now.getTime()) / 86_400_000;
  if (daysUntilDue > RECALL_LEAD_DAYS) return false;
  if (daysUntilDue < -RECALL_MAX_OVERDUE_DAYS) return false;

  if (c.lastRecalledAt) {
    const since = (now.getTime() - c.lastRecalledAt.getTime()) / 86_400_000;
    if (since < RECALL_MIN_DAYS_BETWEEN) return false;
  }
  return true;
}

/**
 * The message. Templated, never model-written.
 *
 * It says what they had and roughly when, because "time for your next visit"
 * with no context reads like spam from a business you don't remember using.
 */
export function recallBody(input: {
  businessName: string;
  customerName: string | null;
  serviceName: string | null;
  monthsSince: number;
  callbackNumber?: string | null;
}): string {
  const clean = (v: string | null, max: number) =>
    (v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const name = clean(input.customerName, 40);
  const business = clean(input.businessName, 60);
  const service = clean(input.serviceName, 40);
  const when =
    input.monthsSince >= 2
      ? `about ${Math.round(input.monthsSince)} months ago`
      : "a little while back";
  const what = service ? `your ${service}` : "your last visit";
  const callback = input.callbackNumber?.trim();

  return (
    `Hi${name ? ` ${name}` : ""}, it's ${business} — you're about due since ${what} ${when}. ` +
    `Want to get your next one booked?` +
    (callback ? ` Call or text us at ${callback}.` : "") +
    ` Reply STOP to opt out.`
  );
}

/** Whole months between two dates, for the message copy. */
export function monthsBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / (86_400_000 * 30.44);
}
