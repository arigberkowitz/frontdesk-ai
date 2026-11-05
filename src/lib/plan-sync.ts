/**
 * What a purchased plan does to the business record — the pure part, so the
 * whole policy is unit-tested without Stripe or a database.
 *
 * Before this, paying changed nothing on the client: a self-serve signup sat
 * at status "trial" forever, and a trial unlocks every feature, so a $149
 * Missed-Call Rescue customer was quietly running the $500 Pro product.
 */
import { PLANS, type PlanKey } from "@/config/plans";
import { resolveFeatures } from "@/lib/plan-access";
import { parseLanguages, serializeLanguages } from "@/lib/languages";

const hasSpanish = (l: string) => parseLanguages(l).includes("es");

export interface PlanSyncClient {
  status: string;
  comped: boolean;
  answeringMode: string;
  staffModeEnabled: boolean;
  languages: string;
}

export interface PlanSyncPatch {
  status?: "live";
  trialEndsAt?: null;
  answeringMode?: "all_calls" | "missed_only";
  staffModeEnabled?: boolean;
  languages?: string;
}

const SELLABLE: PlanKey[] = ["backup", "starter", "pro", "scale"];

/**
 * The plan a Stripe subscription is for. Metadata first (our checkouts write
 * it); otherwise match the recurring amount, so a plan switched in Stripe's
 * own portal or dashboard still resolves to the right tier.
 */
export function resolvePlanKey(
  metadataPlan: string | null | undefined,
  item: { unitAmount: number | null | undefined; interval: string | null | undefined } | null,
): PlanKey | null {
  if (metadataPlan && (SELLABLE as string[]).includes(metadataPlan)) return metadataPlan as PlanKey;
  if (!item?.unitAmount) return null;
  const listed = Object.values(PLANS).filter((p) => p.listed);
  const match = listed.find((p) =>
    item.interval === "year" ? p.monthlyPriceCents * 10 === item.unitAmount : p.monthlyPriceCents === item.unitAmount,
  );
  return match?.key ?? null;
}

/**
 * The change to make to the client when a subscription lands or changes.
 * `previousPlan` is what we had stored; a plan-dependent setting the owner
 * chose (e.g. a Starter who prefers missed-only) is only reset when the plan
 * actually changes.
 */
export function planSyncPatch(
  client: PlanSyncClient,
  plan: PlanKey | null,
  subStatus: string,
  previousPlan: string | null,
): PlanSyncPatch {
  const patch: PlanSyncPatch = {};
  const paying = subStatus === "active" || subStatus === "trialing";
  if (!paying || !plan) return patch;

  // Fix 1: paid → live, so plan gates bind.
  if (client.status === "trial") {
    patch.status = "live";
    patch.trialEndsAt = null;
  }
  if (client.comped) return patch;

  const features = resolveFeatures({ status: "live", comped: false, subscriptionPlan: plan });
  const planChanged = previousPlan !== plan;

  // Fix 2: Rescue is missed calls only — always. Upgrading out of Rescue turns
  // 24/7 back on.
  if (!features.has("all_calls")) {
    if (client.answeringMode !== "missed_only") patch.answeringMode = "missed_only";
  } else if (planChanged && client.answeringMode === "missed_only" && previousPlan === "backup") {
    patch.answeringMode = "all_calls";
  }

  // Fix 3: staff mode is Pro.
  if (!features.has("staff_mode") && client.staffModeEnabled) patch.staffModeEnabled = false;

  // Fix 6: every plan advertises English & Spanish automatically.
  if (planChanged && !hasSpanish(client.languages)) {
    patch.languages = addSpanish(client.languages);
  }
  return patch;
}

export function addSpanish(languages: string): string {
  if (hasSpanish(languages)) return languages;
  return serializeLanguages([...parseLanguages(languages), "es"]);
}
