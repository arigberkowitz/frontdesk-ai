/**
 * Recurring revenue (MRR) and the billing-health warnings next to it.
 *
 * Pure (no DB) so the rules are unit-tested. `getPortfolioMetrics` loads the
 * clients and their subscription rows and hands them here.
 *
 * The rule: a subscription counts toward MRR only when BOTH sides agree it's
 * real money —
 *   - the subscription is `active` or `trialing` (Stripe's view), AND
 *   - the client is `live` or `trial` (our view).
 * MRR used to look at the subscription alone, so a business we had paused
 * (or churned) kept adding its old plan price to MRR and margin as long as its
 * Stripe row still said "active" — even with a billing period that ended
 * months ago. `trialing` keeps counting for live/trial clients, exactly as
 * before; only paused / churned / draft clients drop out.
 *
 * Whenever the two sides disagree, we surface it instead of silently picking
 * one: that's the billing-warnings list on the dashboard.
 */

export const MRR_SUBSCRIPTION_STATUSES = ["active", "trialing"] as const;
export const MRR_CLIENT_STATUSES = ["live", "trial"] as const;

export interface MrrClient {
  id: string;
  name: string;
  status: string;
}

export interface MrrSubscription {
  clientId: string;
  status: string | null;
  monthlyPriceCents: number | null;
  currentPeriodEnd: Date | null;
}

export type BillingWarningKind =
  /** Subscription says active/trialing, but the client is paused, churned or draft. */
  | "billing_inactive_client"
  /** Client is live, but there's no subscription row at all. */
  | "live_without_subscription"
  /** Client is live/trial, but the subscription is past_due / canceled / paused / incomplete. */
  | "subscription_not_billing";

export interface BillingWarning {
  clientId: string;
  clientName: string;
  kind: BillingWarningKind;
  clientStatus: string;
  subscriptionStatus: string | null;
  currentPeriodEnd: Date | null;
  /** True when the subscription's period end is in the past. */
  periodEnded: boolean;
  /** One plain sentence for the dashboard. */
  message: string;
}

export interface MrrResult {
  mrrCents: number;
  /** One line per counted subscription, largest first. */
  mrrByClient: { clientId: string; name: string; cents: number; subscriptionStatus: string }[];
  warnings: BillingWarning[];
}

const isIn = <T extends string>(list: readonly T[], v: string | null | undefined): v is T =>
  v != null && (list as readonly string[]).includes(v);

/** Does this client/subscription pair count toward MRR? */
export function countsTowardMrr(clientStatus: string, subscriptionStatus: string | null): boolean {
  return isIn(MRR_CLIENT_STATUSES, clientStatus) && isIn(MRR_SUBSCRIPTION_STATUSES, subscriptionStatus);
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function computeMrr(
  clients: MrrClient[],
  subscriptions: MrrSubscription[],
  now: Date = new Date(),
): MrrResult {
  // One subscription per client (unique index); if that ever breaks, the
  // first row wins rather than double-counting.
  const subByClient = new Map<string, MrrSubscription>();
  for (const s of subscriptions) if (!subByClient.has(s.clientId)) subByClient.set(s.clientId, s);

  const mrrByClient: MrrResult["mrrByClient"] = [];
  const warnings: BillingWarning[] = [];

  for (const c of clients) {
    const sub = subByClient.get(c.id) ?? null;
    const subStatus = sub?.status ?? null;
    const periodEnd = sub?.currentPeriodEnd ?? null;
    const periodEnded = periodEnd != null && periodEnd.getTime() < now.getTime();
    const base = {
      clientId: c.id,
      clientName: c.name,
      clientStatus: c.status,
      subscriptionStatus: subStatus,
      currentPeriodEnd: periodEnd,
      periodEnded,
    };

    if (sub && countsTowardMrr(c.status, subStatus)) {
      const cents = sub.monthlyPriceCents ?? 0;
      if (cents > 0) mrrByClient.push({ clientId: c.id, name: c.name, cents, subscriptionStatus: subStatus! });
    }

    const clientActive = isIn(MRR_CLIENT_STATUSES, c.status);
    const subBilling = isIn(MRR_SUBSCRIPTION_STATUSES, subStatus);

    if (sub && subBilling && !clientActive) {
      warnings.push({
        ...base,
        kind: "billing_inactive_client",
        message:
          `Client is ${c.status}, but its subscription still says ${subStatus}` +
          (periodEnd ? (periodEnded ? ` (period ended ${fmtDate(periodEnd)})` : ` (renews ${fmtDate(periodEnd)})`) : "") +
          ". Not counted in MRR.",
      });
    } else if (!sub && c.status === "live") {
      warnings.push({
        ...base,
        kind: "live_without_subscription",
        message: "Live, but there's no subscription on file — this client isn't being billed.",
      });
    } else if (sub && clientActive && !subBilling) {
      warnings.push({
        ...base,
        kind: "subscription_not_billing",
        message: `Client is ${c.status}, but its subscription is ${subStatus ?? "missing a status"}. Not counted in MRR.`,
      });
    }
  }

  mrrByClient.sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name));
  const mrrCents = mrrByClient.reduce((sum, r) => sum + r.cents, 0);
  return { mrrCents, mrrByClient, warnings };
}
