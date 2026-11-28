import type { Outcome } from "@/lib/operator/controls";

/**
 * Stop billing when an owner closes their account.
 *
 * Closing used to say "cancel your plan under Manage billing above", which
 * means anyone who skipped that line got charged next month for a phone
 * line we had already switched off. Now closing cancels every open Stripe
 * subscription for the business straight away, using the same helper the
 * operator full delete uses: no proration, no refund, no final invoice. The
 * customer is never billed again.
 *
 * Safe to run twice. A subscription that is already canceled, or that Stripe
 * no longer knows about, counts as done.
 */
export interface CloseBillingDeps {
  stripeConfigured: boolean;
  getSubscription(clientId: string): Promise<{
    stripeSubscriptionId: string | null;
    stripeCustomerId: string | null;
    status: string | null;
  } | null>;
  markSubscriptionStatus(clientId: string, status: "canceled"): Promise<void>;
  stripeCancel(subscriptionId: string, opts: { prorate: boolean }): Promise<Outcome>;
  stripeOpenSubscriptionsFor(customerId: string): Promise<string[]>;
  stripeSubscriptionsByClient(clientId: string): Promise<string[]>;
}

export type CloseBillingResult =
  /** Nothing was ever set up to bill. */
  | { status: "none" }
  /** Every subscription found was already canceled. */
  | { status: "already_canceled"; ids: string[] }
  | { status: "canceled"; ids: string[] }
  /** Billing could NOT be stopped. The caller must not report the account as closed. */
  | { status: "failed"; error: string };

export async function cancelBillingOnClose(clientId: string, d: CloseBillingDeps): Promise<CloseBillingResult> {
  try {
    const sub = await d.getSubscription(clientId);
    const onFile = Boolean(sub?.stripeSubscriptionId || sub?.stripeCustomerId);
    if (!d.stripeConfigured) {
      return onFile
        ? { status: "failed", error: "Stripe isn't configured, so the subscription could not be canceled." }
        : { status: "none" };
    }
    const ids = new Set<string>();
    if (sub?.stripeSubscriptionId && sub.status !== "canceled") ids.add(sub.stripeSubscriptionId);
    if (sub?.stripeCustomerId) for (const id of await d.stripeOpenSubscriptionsFor(sub.stripeCustomerId)) ids.add(id);
    for (const id of await d.stripeSubscriptionsByClient(clientId)) ids.add(id);

    if (ids.size === 0) {
      if (sub && sub.status !== "canceled" && onFile) await d.markSubscriptionStatus(clientId, "canceled");
      return sub?.status === "canceled" ? { status: "already_canceled", ids: [] } : { status: "none" };
    }
    let gone = 0;
    for (const id of ids) {
      if ((await d.stripeCancel(id, { prorate: false })) === "already_gone") gone += 1;
    }
    if (sub) await d.markSubscriptionStatus(clientId, "canceled");
    const list = [...ids];
    return gone === ids.size ? { status: "already_canceled", ids: list } : { status: "canceled", ids: list };
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}
