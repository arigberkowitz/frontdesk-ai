/**
 * Minute caps: when a business has used enough minutes this billing period
 * that the owner and the operator should hear about it. Pure — the rows come
 * from minute-cap-run.ts — so every boundary is tested directly.
 *
 * What a cap does NOT do: it never ends, refuses or shortens a call, and it
 * never charges anything. Past the cap plus MINUTE_CAP_GRACE_PCT, the owner
 * gets one email suggesting a plan that fits, and the operator is flagged in
 * the morning health check — once each per billing period. A hard stop would
 * punish the caller, who agreed to nothing, and a surprise overage bill is
 * exactly what the pricing page promises won't happen.
 */
import { PLANS, minuteAlertThreshold, type PlanKey } from "@/config/plans";
import { isBlocked } from "@/lib/spam";

export interface UsageCallRow {
  durationSec: number | null;
  outcome: string | null;
  fromNumber: string | null;
}

/**
 * Seconds that count toward the cap. Robocalls (outcome "spam") and callers
 * the owner blocked don't: the owner never wanted those calls, and charging
 * their minutes against the plan is how the category loses its customers.
 */
export function countedSeconds(rows: UsageCallRow[], blockedNumbers: string[]): number {
  let total = 0;
  for (const r of rows) {
    if (!r.durationSec || r.durationSec <= 0) continue;
    if (r.outcome === "spam") continue;
    if (isBlocked(r.fromNumber, blockedNumbers)) continue;
    total += r.durationSec;
  }
  return total;
}

export const usedMinutesFromSeconds = (seconds: number): number => Math.ceil(Math.max(0, seconds) / 60);

/** Dedupe state, kept in clients.setup_flags.minuteCap (no migration). */
export interface MinuteCapFlags {
  /** ISO start of the billing period these flags belong to. */
  period?: string;
  ownerWarnedAt?: string;
  adminFlaggedAt?: string;
}

export interface MinuteCapDecision {
  /** Used minutes are past cap + grace. */
  over: boolean;
  /** Minute count that triggers the emails (cap + grace), or null with no cap. */
  threshold: number | null;
  sendOwner: boolean;
  flagAdmin: boolean;
}

/**
 * Whether to email the owner / flag the operator now. Flags from an earlier
 * billing period don't count, so a new period starts clean.
 */
export function minuteCapDecision(input: {
  plan: PlanKey;
  usedMinutes: number;
  periodStart: Date;
  flags: MinuteCapFlags | undefined;
}): MinuteCapDecision {
  const threshold = minuteAlertThreshold(PLANS[input.plan]);
  if (threshold === null) return { over: false, threshold, sendOwner: false, flagAdmin: false };
  const over = input.usedMinutes > threshold;
  const samePeriod = input.flags?.period === input.periodStart.toISOString();
  return {
    over,
    threshold,
    sendOwner: over && !(samePeriod && input.flags?.ownerWarnedAt),
    flagAdmin: over && !(samePeriod && input.flags?.adminFlaggedAt),
  };
}

/** The flags after this run, reset when the billing period changed. */
export function nextMinuteCapFlags(
  previous: MinuteCapFlags | undefined,
  periodStart: Date,
  marks: { ownerWarnedAt?: string; adminFlaggedAt?: string },
): MinuteCapFlags {
  const period = periodStart.toISOString();
  const base: MinuteCapFlags = previous?.period === period ? { ...previous } : { period };
  return { ...base, ...marks, period };
}

/** The smallest listed plan whose alert threshold covers this usage, if any is bigger than the current one. */
export function planThatFits(current: PlanKey, usedMinutes: number): PlanKey | null {
  const ladder: PlanKey[] = ["backup", "starter", "pro"];
  const from = ladder.indexOf(current);
  for (const key of ladder.slice(from + 1)) {
    const t = minuteAlertThreshold(PLANS[key]);
    if (t !== null && usedMinutes <= t) return key;
  }
  return null;
}

const n = (x: number) => x.toLocaleString("en-US");
const escHtml = (s: string) => s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);

/** The owner's email. Plain: what happened, what didn't, what to do. */
export function renderOwnerCapEmail(input: {
  businessName: string;
  plan: PlanKey;
  usedMinutes: number;
  periodStart: Date;
  periodEnd: Date | null;
  plansUrl: string;
  questionsText: string;
  questionsHtml: string;
}): { subject: string; text: string; html: string } {
  const plan = PLANS[input.plan];
  const cap = plan.includedMinutes ?? 0;
  const fit = planThatFits(input.plan, input.usedMinutes);
  const fitPlan = fit ? PLANS[fit] : null;
  const day = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
  const capWords = plan.fairUse ? `a fair-use limit of ${n(cap)} minutes a month` : `${n(cap)} minutes a month`;
  const resets = input.periodEnd ? ` Your count starts over on ${day(input.periodEnd)}.` : "";
  const price = (cents: number) => `$${(cents / 100).toFixed(0)}`;
  const askText = fitPlan
    ? `${fitPlan.name} covers ${fitPlan.fairUse ? "up to " : ""}${n(fitPlan.includedMinutes ?? 0)} minutes a month for ${price(fitPlan.monthlyPriceCents)}/mo. Switch under Settings → Plan & billing: ${input.plansUrl}`
    : "No plan covers more than that, so get in touch and we'll work out what fits.";
  const askHtml = fitPlan
    ? `${escHtml(fitPlan.name)} covers ${fitPlan.fairUse ? "up to " : ""}${n(fitPlan.includedMinutes ?? 0)} minutes a month for ${price(fitPlan.monthlyPriceCents)}/mo. <a href="${escHtml(input.plansUrl)}">Switch plans</a>.`
    : "No plan covers more than that, so get in touch and we'll work out what fits.";
  const lead = `Since ${day(input.periodStart)}, your AI receptionist has answered ${n(input.usedMinutes)} minutes of calls for ${input.businessName}. Your ${plan.name} plan covers ${capWords}.`;
  const calm = "Nothing changes on your line: every call still gets answered, and there's no overage charge.";
  return {
    subject: `${input.businessName}: ${n(input.usedMinutes)} minutes of calls since ${day(input.periodStart)}`,
    text: `${lead}\n\n${calm}${resets}\n\n${askText}\n\n${input.questionsText}`,
    html: `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px">
  <h2 style="margin:0 0 12px;font-size:18px">${n(input.usedMinutes)} minutes of calls since ${escHtml(day(input.periodStart))}</h2>
  <p style="margin:0 0 10px;font-size:15px">${escHtml(lead)}</p>
  <p style="margin:0 0 10px;font-size:15px">${escHtml(calm + resets)}</p>
  <p style="margin:0 0 10px;font-size:15px">${askHtml}</p>
  <p style="color:#999;font-size:12px;margin-top:18px">${input.questionsHtml} · FrontDesk AI</p>
</div>`,
  };
}

/** One line for the operator's health-check email. */
export function adminCapLine(input: {
  businessName: string;
  plan: PlanKey;
  usedMinutes: number;
  ownerEmailed: boolean;
}): string {
  const plan = PLANS[input.plan];
  const fit = planThatFits(input.plan, input.usedMinutes);
  const owner = !input.ownerEmailed
    ? "The owner email didn't go out (no address, or the send failed)."
    : fit
      ? `The owner was emailed a nudge to ${PLANS[fit].name}.`
      : "No bigger plan fits, so the owner was asked to get in touch. Worth a call.";
  return `${input.businessName} is at ${n(input.usedMinutes)} minutes this billing period on ${plan.name} (${n(plan.includedMinutes ?? 0)} included, alert at ${n(minuteAlertThreshold(plan) ?? 0)}). Calls are still answered and no overage is billed. ${owner}`;
}
