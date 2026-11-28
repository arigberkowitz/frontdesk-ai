/**
 * Pricing plans and cost assumptions (§10). Editable here so numbers can change
 * without touching billing/margin logic. All money is in integer cents.
 *
 * Business defaults from the PRD:
 *   Setup fee:  none. It existed to cover setting a business up, and businesses
 *               now set themselves up. Charging it at the end of a free trial —
 *               the first bill someone sees — is how a conversion becomes a
 *               refund request. Kept on the type at 0 so a hand-sold deal can
 *               still carry one through the operator checkout.
 *   Monthly:    $199–$599 flat per client (raised from $149/$300/$500,
 *               Nov 2026; existing subscriptions keep the price they signed at)
 *   Trial:      14 days free, no card, then pick a plan
 */
import { LANGUAGE_OPTIONS, MAX_LANGUAGES } from "@/lib/languages";

const LANGUAGE_HIGHLIGHT = `${LANGUAGE_OPTIONS.length} languages — pick up to ${MAX_LANGUAGES}`;

export type PlanKey = "backup" | "starter" | "pro" | "scale";

export interface Plan {
  key: PlanKey;
  name: string;
  /** Flat monthly subscription, cents. */
  monthlyPriceCents: number;
  /** One-time setup fee, cents. Zero on every self-serve plan — see below. */
  setupFeeCents: number;
  /**
   * Earlier list prices, cents per month. Existing Stripe subscriptions keep
   * the price they signed up at, so a subscription without our metadata can
   * still be matched to its plan by amount.
   */
  legacyMonthlyPriceCents?: number[];
  /** Shown on the pricing page and offered at checkout. */
  listed: boolean;
  /**
   * Minutes a month the price covers. Never billed and never enforced on a
   * live call: past it (plus MINUTE_CAP_GRACE_PCT) the owner and the operator
   * get one email each per billing period (minute-cap.ts). Null = no cap.
   */
  includedMinutes: number | null;
  /**
   * The cap is a fair-use ceiling rather than a bundle (Pro). Only changes
   * the wording: "up to 2,500 minutes a month (fair use)".
   */
  fairUse?: boolean;
  description: string;
  highlights: string[];
}

export const PLANS: Record<PlanKey, Plan> = {
  backup: {
    key: "backup",
    name: "Missed-Call Rescue",
    monthlyPriceCents: 19_900, // $199
    legacyMonthlyPriceCents: [14_900],
    setupFeeCents: 0,
    listed: true,
    includedMinutes: 200,
    description: "You answer when you can — the AI catches every call you miss.",
    highlights: [
      "Answers missed & after-hours calls only",
      "Books appointments & captures leads on those calls",
      "Confirmation & reminder texts",
      "Instant owner alerts",
      LANGUAGE_HIGHLIGHT,
      "Spam & robocall screening",
      "Upgrade to 24/7 coverage anytime",
    ],
  },
  starter: {
    key: "starter",
    name: "Starter",
    monthlyPriceCents: 39_900, // $399
    legacyMonthlyPriceCents: [30_000],
    setupFeeCents: 0,
    listed: true,
    includedMinutes: 500,
    description: "Single-location businesses getting started with 24/7 coverage.",
    highlights: [
      "24/7 AI receptionist — every call answered",
      "Appointment booking + confirmation texts",
      "Lead capture & instant owner alerts",
      LANGUAGE_HIGHLIGHT,
      "Spam & robocall screening",
    ],
  },
  pro: {
    key: "pro",
    name: "Pro",
    monthlyPriceCents: 59_900, // $599
    legacyMonthlyPriceCents: [50_000],
    setupFeeCents: 0,
    listed: true,
    includedMinutes: 2_500,
    fairUse: true,
    description: "For teams: calls leads back on request, books by team member, and gets better every week.",
    highlights: [
      "Everything in Starter",
      "One tap: your AI calls a lead back for you",
      "Staff mode — team members with their own calendars",
      "Website chat — the same AI answers visitors on your site, takes leads and books",
      "Every night we review your calls and suggest better answers for you to approve",
    ],
  },
  // Retired: folded into Pro. Kept defined, and only defined, so any
  // subscription already carrying this key still resolves to a name and a
  // price instead of crashing a billing page. Never listed, never sold.
  scale: {
    key: "scale",
    name: "Scale (legacy)",
    monthlyPriceCents: 60_000, // $600
    setupFeeCents: 0,
    listed: false,
    includedMinutes: 2_500,
    fairUse: true,
    description: "Folded into Pro.",
    highlights: [],
  },
};

export const DEFAULT_PLAN: PlanKey = "pro";
export const TRIAL_DAYS = 14;

/**
 * How far past its included minutes a business may go before anyone is told.
 * 10 = Rescue 220, Starter 550, Pro 2,750. A busy week shouldn't trigger an
 * email; a business living well above its plan should. One constant, so the
 * alert, the portal meter and the tests can't drift apart.
 */
export const MINUTE_CAP_GRACE_PCT = 10;

/** The minute count at which the over-cap emails go out (cap + grace), or null with no cap. */
export function minuteAlertThreshold(plan: Pick<Plan, "includedMinutes">): number | null {
  if (plan.includedMinutes === null) return null;
  return Math.ceil((plan.includedMinutes * (100 + MINUTE_CAP_GRACE_PCT)) / 100);
}

/**
 * Operator margin inputs (§10, EPIC A4). Cents. Tune to actual vendor costs.
 * Margin = monthly price − Retell minutes − SMS − per-client overhead.
 */
export const COST_ASSUMPTIONS = {
  // ~$0.13/min: Retell voice infra $0.055 + ElevenLabs $0.04 + GPT-4.1 mini
  // $0.0128 + telephony $0.015 (retellai.com/pricing, Nov 2026), rounded up
  // for long prompts, which Retell bills as extra time.
  retellPerMinuteCents: 13,
  smsPerMessageCents: 1, // ~$0.0079/segment Twilio, rounded up
  overheadPerClientCents: 2_000, // $20/mo: Cal.com, Resend, misc.
} as const;

/**
 * What a card should say about minutes.
 *
 * The pricing cards used to show a price and a feature list and nothing about
 * volume, which loses the comparison twice over: a shopper can't tell what
 * they're buying, and the flat-rate promise — the one thing this pricing does
 * that the category mostly doesn't — never gets made. Rosie bills overages,
 * Abby Connect bills $2.99 a minute past the bundle, Smith.ai bills $3 a
 * handoff. Here `includedMinutes` is a soft cap we watch, not a meter we bill,
 * so say so on the card where it can do some work.
 */
export function minutesLabel(plan: Plan): string {
  if (plan.includedMinutes === null) return "No overage charges";
  const n = plan.includedMinutes.toLocaleString("en-US");
  return plan.fairUse
    ? `Up to ${n} min a month (fair use) \u00b7 no overage charges`
    : `${n} minutes included \u00b7 no overage charges`;
}

/** The plans a customer can actually see and buy. */
export const planList = (): Plan[] => Object.values(PLANS).filter((p) => p.listed);

/** e.g. "Missed-Call Rescue covers 200 minutes a month, Starter 500, and Pro up to 2,500 (fair use)." */
export function minutesFaqLine(plans: Plan[] = planList()): string {
  const parts = plans
    .filter((p) => p.includedMinutes !== null)
    .map((p, i) => {
      const n = `${p.fairUse ? "up to " : ""}${p.includedMinutes!.toLocaleString("en-US")}`;
      return i === 0
        ? `${p.name} covers ${n} minutes a month${p.fairUse ? " (fair use)" : ""}`
        : `${p.name} ${n}${p.fairUse ? " (fair use)" : ""}`;
    });
  if (parts.length === 0) return "";
  if (parts.length === 1) return `${parts[0]}.`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}.`;
}
