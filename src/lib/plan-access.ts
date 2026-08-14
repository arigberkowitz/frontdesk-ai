import "server-only";
import { and, desc, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";
import { type PlanKey } from "@/config/plans";

/**
 * Plan gating — what each tier actually buys.
 *
 * Until this existed, the $149 plan and the $500 plan ran the identical
 * product; the pricing page was three descriptions of one thing. These are
 * the real switches:
 *
 *   backup   → the AI answers missed calls only
 *   starter  → full 24/7 receptionist
 *   pro      → + outbound AI callbacks, staff mode, nightly AI improvement/QA
 *
 * Two deliberate softnesses:
 *  - Trials and comped businesses get EVERYTHING. A trial is a demo of the
 *    real product, not of the cheap tier; a comp is a favor, not a contract.
 *  - A live client with no subscription row also gets everything. Those are
 *    hand-set-up businesses from before billing existed — a gate that
 *    switches features off under a paying-by-check customer is a bug wearing
 *    a pricing page as a costume. Gates bind only to a purchased plan.
 */

export type PlanFeature =
  /** The AI answers every call, not just missed ones. */
  | "all_calls"
  /** The "AI calls them back" button on leads. */
  | "outbound_ai_calls"
  /** Named team members with per-person bookings. */
  | "staff_mode"
  /** Nightly self-improvement + call-QA agent runs. */
  | "ai_improvement";

const EVERYTHING: readonly PlanFeature[] = [
  "all_calls",
  "outbound_ai_calls",
  "staff_mode",
  "ai_improvement",
];

const PLAN_FEATURES: Record<PlanKey, readonly PlanFeature[]> = {
  backup: [],
  starter: ["all_calls"],
  pro: EVERYTHING,
  // Legacy tier, priced above Pro — never sold now, never downgraded.
  scale: EVERYTHING,
};

/** What the owner reads when a gate stops them. Keyed by what they tried. */
export const UPGRADE_MESSAGES: Record<PlanFeature, string> = {
  all_calls:
    "Your Missed-Call Rescue plan answers only the calls you miss. Upgrade to Starter and the AI answers every call, 24/7.",
  outbound_ai_calls:
    "Having the AI call leads back is a Pro feature. Upgrade to Pro and this button dials for you.",
  staff_mode:
    "Team members with their own calendars is a Pro feature. Upgrade to Pro to turn on staff mode.",
  ai_improvement:
    "Nightly AI tuning is a Pro feature. Upgrade to Pro and your receptionist reviews its own calls every night.",
};

export interface AccessInput {
  /** clients.status */
  status: string;
  /** setupFlags.comped */
  comped: boolean;
  /** The purchased plan, if a subscription exists. */
  subscriptionPlan: string | null;
}

/** Pure resolution — the whole policy, testable without a database. */
export function resolveFeatures(input: AccessInput): ReadonlySet<PlanFeature> {
  if (input.comped) return new Set(EVERYTHING);
  if (input.status === "trial") return new Set(EVERYTHING);
  if (!input.subscriptionPlan) return new Set(EVERYTHING);
  const plan = PLAN_FEATURES[input.subscriptionPlan as PlanKey];
  // An unrecognized plan string fails OPEN for the same reason no-sub does:
  // never strand a paying customer over a key mismatch.
  return new Set(plan ?? EVERYTHING);
}

export interface PlanAccess {
  features: ReadonlySet<PlanFeature>;
  has: (f: PlanFeature) => boolean;
  /** The stored plan key, when one exists. */
  plan: string | null;
}

/** Newest live subscription per client, one query for any number of clients. */
async function newestPlans(clientIds: string[]): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  if (clientIds.length === 0) return map;
  const rows = await db
    .select({ clientId: subscriptions.clientId, plan: subscriptions.plan })
    .from(subscriptions)
    .where(
      and(
        inArray(subscriptions.clientId, clientIds),
        isNull(subscriptions.deletedAt),
        sql`${subscriptions.status} in ('active','trialing')`,
      ),
    )
    .orderBy(desc(subscriptions.createdAt));
  for (const row of rows) {
    if (!map.has(row.clientId)) map.set(row.clientId, row.plan);
  }
  return map;
}

/** Access for one client the actions already loaded. */
export async function planAccessFor(client: {
  id: string;
  status: string;
  setupFlags?: { comped?: boolean } | null;
}): Promise<PlanAccess> {
  const plans = await newestPlans([client.id]);
  const features = resolveFeatures({
    status: client.status,
    comped: Boolean(client.setupFlags?.comped),
    subscriptionPlan: plans.get(client.id) ?? null,
  });
  return { features, has: (f) => features.has(f), plan: plans.get(client.id) ?? null };
}

/**
 * Batch filter for the agent sweeps: which of these clients get `feature`.
 * One subscription query however many clients the night's run covers.
 */
export async function filterByFeature<
  T extends { id: string; status: string; setupFlags?: { comped?: boolean } | null },
>(clients: T[], feature: PlanFeature): Promise<T[]> {
  const plans = await newestPlans(clients.map((c) => c.id));
  return clients.filter((c) =>
    resolveFeatures({
      status: c.status,
      comped: Boolean(c.setupFlags?.comped),
      subscriptionPlan: plans.get(c.id) ?? null,
    }).has(feature),
  );
}
