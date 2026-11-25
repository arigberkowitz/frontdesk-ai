import { track } from "@vercel/analytics";

/**
 * Named conversion events for Vercel Web Analytics.
 *
 * Custom events only show up on Pro and Enterprise. Pro allows at most two
 * properties per event — keep payloads that small. Never send names, emails,
 * or phone numbers; the sanitizer drops those keys and any value that looks
 * like an email or phone, but call sites should not pass them at all.
 *
 * There is no public marketing waitlist form today, so `waitlist_submit` is
 * reserved and unused until one exists. The in-product appointment waitlist
 * is not a signup-funnel action.
 */
export const FUNNEL_EVENTS = {
  signupStart: "signup_start",
  signupComplete: "signup_complete",
  demoCallRequested: "demo_call_requested",
  pricingPlanCta: "pricing_plan_cta",
  waitlistSubmit: "waitlist_submit",
} as const;

export type FunnelEvent = (typeof FUNNEL_EVENTS)[keyof typeof FUNNEL_EVENTS];

const FUNNEL_EVENT_SET = new Set<string>(Object.values(FUNNEL_EVENTS));

/** Keys that must never go out, even if a call site slips. */
const PII_KEY =
  /(e-?mail|phone|mobile|^tel$|telephone|(^|_)(first|last|full|customer|user|owner|business)?names?$)/i;

const EMAIL_VALUE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_VALUE = /^\+?[\d\s().-]{7,}$/;

export type FunnelPropValue = string | number | boolean | null;

export function isFunnelEvent(name: string): name is FunnelEvent {
  return FUNNEL_EVENT_SET.has(name);
}

/**
 * Keep only primitive, non-PII properties. Nested objects and anything that
 * looks like a name, email, or phone are dropped.
 */
export function sanitizeFunnelProps(
  props?: Record<string, unknown>,
): Record<string, FunnelPropValue> | undefined {
  if (!props) return undefined;
  const out: Record<string, FunnelPropValue> = {};
  for (const [key, value] of Object.entries(props)) {
    if (PII_KEY.test(key)) continue;
    if (value === null) {
      out[key] = null;
      continue;
    }
    if (typeof value === "boolean") {
      out[key] = value;
      continue;
    }
    if (typeof value === "number") {
      if (Number.isFinite(value)) out[key] = value;
      continue;
    }
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (EMAIL_VALUE.test(trimmed) || PHONE_VALUE.test(trimmed)) continue;
    out[key] = trimmed;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function trackFunnelEvent(name: string, props?: Record<string, unknown>): void {
  if (!isFunnelEvent(name)) return;
  const safe = sanitizeFunnelProps(props);
  track(name, safe);
}
