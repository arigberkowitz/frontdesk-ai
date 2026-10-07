import { PLANS, planList, TRIAL_DAYS, type Plan, type PlanKey } from "@/config/plans";

/**
 * Trial-to-paid nudges: the pure parts (when the trial started, what to say
 * about it, which plan the upgrade button opens). The numbers themselves come
 * from real calls and appointments in `data/trial-progress.ts`.
 */

export interface TrialProgress {
  /** Calls the AI answered since the trial started (spam excluded). */
  calls: number;
  /** Appointments the AI booked on a call since the trial started (not cancelled / no-show). */
  booked: number;
  /** Of those calls, how many came in after hours. */
  afterHours: number;
  /** When "this trial" began. */
  since: Date;
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * When this trial began: TRIAL_DAYS before it ends, but never before the
 * business existed (an operator-approved trial resets the end date, and a
 * hand-set one can be anything).
 */
export function trialStart(endsAt: Date, createdAt: Date | null, trialDays = TRIAL_DAYS): Date {
  const fromEnd = new Date(endsAt.getTime() - trialDays * DAY);
  if (!createdAt) return fromEnd;
  return createdAt > fromEnd ? createdAt : fromEnd;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * One honest sentence about what the trial has done. Never inflates: zero is
 * said as zero, with the one thing that usually fixes it.
 */
export function trialSummaryLine(p: Pick<TrialProgress, "calls" | "booked">, hasNumber: boolean): string {
  if (p.calls === 0) {
    return hasNumber
      ? "No calls yet this trial. Forward your business line to your AI and it starts catching the calls you miss."
      : "No calls yet this trial. Try it with a test call on the Your AI page.";
  }
  const booked = p.booked > 0 ? ` and booked ${plural(p.booked, "appointment")}` : "";
  return `Your AI has handled ${plural(p.calls, "call")}${booked} this trial.`;
}

/** The plan the upgrade button opens checkout on: the one they picked at signup, else Starter. */
export function upgradePlan(intendedPlan: string | null | undefined): Plan {
  const listed = planList().map((p) => p.key);
  const key: PlanKey = listed.includes(intendedPlan as PlanKey) ? (intendedPlan as PlanKey) : "starter";
  return PLANS[key];
}

/** Countdown wording shared by the strip and the Overview card. */
export function daysLeftLabel(daysLeft: number): string {
  return daysLeft <= 0
    ? "Last day of your free trial"
    : `${plural(daysLeft, "day")} left in your free trial`;
}

/** The short version for the slim strip on every page. Null when there's nothing yet. */
export function trialStripSummary(p: Pick<TrialProgress, "calls" | "booked">): string | null {
  if (p.calls === 0) return null;
  return p.booked > 0
    ? `${plural(p.calls, "call")} handled, ${p.booked} booked this trial`
    : `${plural(p.calls, "call")} handled this trial`;
}
