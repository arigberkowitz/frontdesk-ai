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
 *   Monthly:    $149–$500 flat per client
 *   Trial:      21 days free, no card, then pick a plan
 */
export type PlanKey = "backup" | "starter" | "pro" | "scale";

export interface Plan {
  key: PlanKey;
  name: string;
  /** Flat monthly subscription, cents. */
  monthlyPriceCents: number;
  /** One-time setup fee, cents. Zero on every self-serve plan — see below. */
  setupFeeCents: number;
  /** Shown on the pricing page and offered at checkout. */
  listed: boolean;
  /** Soft cap surfaced to operator; v1 is flat-rate (usage shown, not billed). */
  includedMinutes: number | null;
  description: string;
  highlights: string[];
}

export const PLANS: Record<PlanKey, Plan> = {
  backup: {
    key: "backup",
    name: "Missed-Call Rescue",
    monthlyPriceCents: 14_900, // $149
    setupFeeCents: 0,
    listed: true,
    includedMinutes: 200,
    description: "You answer when you can — the AI catches every call you miss.",
    highlights: [
      "Answers missed & after-hours calls only",
      "Books appointments & captures leads on those calls",
      "Instant owner alerts",
      "Upgrade to 24/7 coverage anytime",
    ],
  },
  starter: {
    key: "starter",
    name: "Starter",
    monthlyPriceCents: 30_000, // $300
    setupFeeCents: 0,
    listed: true,
    includedMinutes: 500,
    description: "Single-location businesses getting started with 24/7 coverage.",
    highlights: ["24/7 AI receptionist", "Appointment booking", "Lead capture", "Instant owner alerts"],
  },
  pro: {
    key: "pro",
    name: "Pro",
    monthlyPriceCents: 50_000, // $500
    setupFeeCents: 0,
    listed: true,
    includedMinutes: null,
    description: "High call volume, richer reporting, and someone who answers when you write in.",
    highlights: [
      "Everything in Starter",
      "Daily & weekly digests",
      "ROI dashboard",
      "Custom escalation rules",
      "Priority support & prompt tuning",
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
    includedMinutes: null,
    description: "Folded into Pro.",
    highlights: [],
  },
};

export const DEFAULT_PLAN: PlanKey = "pro";
export const TRIAL_DAYS = 21;

/**
 * Operator margin inputs (§10, EPIC A4). Cents. Tune to actual vendor costs.
 * Margin = monthly price − Retell minutes − SMS − per-client overhead.
 */
export const COST_ASSUMPTIONS = {
  retellPerMinuteCents: 10, // ~$0.10/min voice — adjust to your Retell rate
  smsPerMessageCents: 1, // ~$0.0079/segment Twilio, rounded up
  overheadPerClientCents: 2_000, // $20/mo: Cal.com, Resend, misc.
} as const;

/** The plans a customer can actually see and buy. */
export const planList = (): Plan[] => Object.values(PLANS).filter((p) => p.listed);
