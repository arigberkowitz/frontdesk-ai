/**
 * Pricing plans and cost assumptions (§10). Editable here so numbers can change
 * without touching billing/margin logic. All money is in integer cents.
 *
 * Business defaults from the PRD:
 *   Setup fee:  $750–$1,500 one-time (collected at go-live)
 *   Monthly:    $300–$600 flat per client
 *   Trial:      14-day free pilot, no charge until conversion
 */
export type PlanKey = "starter" | "pro" | "scale";

export interface Plan {
  key: PlanKey;
  name: string;
  /** Flat monthly subscription, cents. */
  monthlyPriceCents: number;
  /** One-time setup fee charged at go-live, cents. */
  setupFeeCents: number;
  /** Soft cap surfaced to operator; v1 is flat-rate (usage shown, not billed). */
  includedMinutes: number | null;
  description: string;
  highlights: string[];
}

export const PLANS: Record<PlanKey, Plan> = {
  starter: {
    key: "starter",
    name: "Starter",
    monthlyPriceCents: 30_000, // $300
    setupFeeCents: 75_000, // $750
    includedMinutes: 500,
    description: "Single-location businesses getting started with 24/7 coverage.",
    highlights: ["24/7 AI receptionist", "Appointment booking", "Lead capture", "Instant owner alerts"],
  },
  pro: {
    key: "pro",
    name: "Pro",
    monthlyPriceCents: 45_000, // $450
    setupFeeCents: 100_000, // $1,000
    includedMinutes: 1_500,
    description: "Busy businesses that want richer reporting and faster handling.",
    highlights: ["Everything in Starter", "Daily & weekly digests", "ROI dashboard", "Priority prompt tuning"],
  },
  scale: {
    key: "scale",
    name: "Scale",
    monthlyPriceCents: 60_000, // $600
    setupFeeCents: 150_000, // $1,500
    includedMinutes: null,
    description: "High call volume with custom workflows and integrations.",
    highlights: ["Everything in Pro", "Unlimited minutes", "Custom escalation rules", "Dedicated support"],
  },
};

export const DEFAULT_PLAN: PlanKey = "pro";
export const TRIAL_DAYS = 14;

/**
 * Operator margin inputs (§10, EPIC A4). Cents. Tune to actual vendor costs.
 * Margin = monthly price − Retell minutes − SMS − per-client overhead.
 */
export const COST_ASSUMPTIONS = {
  retellPerMinuteCents: 10, // ~$0.10/min voice — adjust to your Retell rate
  smsPerMessageCents: 1, // ~$0.0079/segment Twilio, rounded up
  overheadPerClientCents: 2_000, // $20/mo: Cal.com, Resend, misc.
} as const;

export const planList = (): Plan[] => Object.values(PLANS);
