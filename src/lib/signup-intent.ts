/**
 * The pricing card a visitor clicked (plan + billing interval), carried from
 * the public site through sign-up and setup to the plan picker. Everything
 * here is from a URL or a form, so anything unrecognised is dropped rather
 * than trusted.
 */
export type IntentPlan = "backup" | "starter" | "pro";
export type IntentInterval = "month" | "year";

const PLANS: readonly IntentPlan[] = ["backup", "starter", "pro"];

function one(v: unknown): string {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" ? s.trim().toLowerCase() : "";
}

export function parseIntentPlan(v: unknown): IntentPlan | undefined {
  const s = one(v);
  return (PLANS as readonly string[]).includes(s) ? (s as IntentPlan) : undefined;
}

/** Accepts "year"/"yearly"/"annual" and "month"/"monthly"; anything else is ignored. */
export function parseIntentInterval(v: unknown): IntentInterval | undefined {
  const s = one(v);
  if (s === "year" || s === "yearly" || s === "annual") return "year";
  if (s === "month" || s === "monthly") return "month";
  return undefined;
}

function query(plan?: IntentPlan, interval?: IntentInterval): string {
  const p = new URLSearchParams();
  if (plan) p.set("plan", plan);
  if (interval) p.set("interval", interval);
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Where a pricing CTA points. */
export function signUpHref(plan?: IntentPlan, interval?: IntentInterval): string {
  return `/sign-up${query(plan, interval)}`;
}

/** Where sign-up sends them afterwards; "/" when they came with no intent. */
export function afterSignUpUrl(rawPlan: unknown, rawInterval: unknown): string {
  const plan = parseIntentPlan(rawPlan);
  const interval = parseIntentInterval(rawInterval);
  return plan || interval ? `/welcome${query(plan, interval)}` : "/";
}
