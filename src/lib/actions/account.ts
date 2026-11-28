"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { audit } from "@/lib/data/audit";
import { assertClientAccess } from "@/lib/auth-guard";
import { assertClientInOrg, softDeleteClient } from "@/lib/data/clients";
import { syncAgentPrompt } from "@/lib/agent-publish";
import { RETENTION_DAYS } from "@/lib/retention";
import { notifier } from "@/lib/notifier";
import { env } from "@/lib/env";
import { SUPPORT_EMAIL } from "@/config/contact";
import { logger } from "@/lib/logger";
import { confirmationMatches } from "@/lib/account-close";
import { cancelBillingOnClose, type CloseBillingDeps, type CloseBillingResult } from "@/lib/account-close-billing";
import { type ActionState } from "./types";

/**
 * Close the account and schedule the data for deletion.
 *
 * The privacy policy has promised since day one that customers "can exercise
 * these directly in the product," and there was no way to. Only the operator
 * could delete a business, from a screen no customer can reach — so the honest
 * reading was that leaving required emailing a stranger and trusting him. That
 * is the kind of thing a buyer's lawyer finds.
 *
 * Two things have to happen together, and only one of them is the database
 * row. Marking a client deleted does not stop the phone: the Retell agent keeps
 * answering that line and keeps booking appointments into a calendar nobody is
 * reading any more. So the agent is paused FIRST and the delete only records
 * once the line is quiet.
 *
 * Billing stops in the same step. Every open Stripe subscription is canceled
 * immediately (no proration, no final invoice), so closing can never leave a
 * customer paying for a line that no longer answers. If Stripe can't be
 * reached the account is NOT marked closed and the owner is told to retry, the
 * same rule as the agent stop above.
 *
 * Deletion is deferred, not immediate, and the copy says so. The 90-day window
 * is the same one `retention.ts` already enforces and the same one §7 of the
 * privacy policy commits to — it exists so a business that closes by accident
 * on Friday can be restored on Monday, which is a favour worth more than the
 * theatre of an instant wipe.
 */
export async function closeAccountAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const typed = String(formData.get("confirm") ?? "");

  const user = await assertClientAccess(clientId);
  if (user.role !== "operator" && user.role !== "client_admin") {
    return { ok: false, error: "Only your account admin can close the account." };
  }
  await assertClientInOrg(user.orgId, clientId);

  const client = await db.query.clients.findFirst({ where: eq(clients.id, clientId) });
  if (!client) return { ok: false, error: "Business not found." };
  if (client.deletedAt) {
    // Idempotent: a repeat close still makes sure nothing can bill.
    const again = await stopBilling(clientId, user.id);
    if (again.status === "failed") {
      return {
        ok: false,
        error: `This account is closed, but we couldn't confirm billing is canceled. Email ${SUPPORT_EMAIL} and we'll cancel it by hand.`,
      };
    }
    return { ok: true, message: "This account is already closed, and billing is canceled." };
  }
  if (!confirmationMatches(typed, client.name)) {
    return {
      ok: false,
      fieldErrors: { confirm: [`Type “${client.name}” exactly to confirm.`] },
    };
  }

  // Quiet the line before recording the close. If this throws we stop: an
  // account marked deleted whose AI is still answering and booking is worse
  // than an account that failed to close and said so.
  try {
    await db.update(clients).set({ status: "paused" }).where(eq(clients.id, clientId));
    await syncAgentPrompt(client.orgId, clientId);
  } catch (err) {
    logger.error("account.close.agent_stop_failed", {
      clientId,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      error:
        "We couldn't stop your AI receptionist just now, so we haven't closed the account — closing it while the line is still answering would leave callers booking into a calendar nobody reads. Please try again in a minute, or contact support and we'll finish it by hand.",
    };
  }

  const billing = await stopBilling(clientId, user.id);
  if (billing.status === "failed") {
    return {
      ok: false,
      error: `Your AI receptionist has stopped answering, but we couldn't cancel your subscription just now, so the account isn't closed yet and you haven't been charged anything new. Please try again in a minute, or email ${SUPPORT_EMAIL} and we'll cancel it by hand.`,
    };
  }

  await softDeleteClient(user.orgId, clientId);

  logger.info("account.closed", { clientId, actor: user.id });
  void audit({ clientId, actor: user.id, action: "account.closed", detail: { by: user.email } });

  // Tell the operator a customer left. Churn you find out about 90 days later,
  // when the purge job deletes the row, is churn you could never have called
  // about.
  void notifier.sendEmail({
    to: env.ALERT_EMAIL,
    subject: `Account closed — ${client.name}`,
    text: `${client.name} closed their FrontDesk AI account.\n\nClosed by: ${user.email}\nStatus before closing: ${client.status}\nBilling: ${billingLine(billing)}\nData is scheduled for permanent deletion in ${RETENTION_DAYS} days and can be restored until then by clearing deleted_at.`,
  });

  revalidatePath("/portal", "layout");
  revalidatePath(`/clients/${clientId}`);
  return {
    ok: true,
    message: `Account closed. Your receptionist has stopped answering${billing.status === "canceled" ? ", your subscription is canceled and you won't be charged again" : ""}, and your data will be permanently deleted in ${RETENTION_DAYS} days — email support before then if you want it back.`,
  };
}

function billingLine(b: CloseBillingResult): string {
  if (b.status === "canceled") return `canceled ${b.ids.join(", ")} (no refund, no proration, no final invoice)`;
  if (b.status === "already_canceled") return "already canceled";
  if (b.status === "none") return "no subscription";
  return `FAILED: ${b.error}`;
}

/** Cancel every open subscription for the business, and log what happened. */
async function stopBilling(clientId: string, actor: string): Promise<CloseBillingResult> {
  // Lazy: the vendor module pulls in Twilio, Retell and Stripe clients.
  const [{ liveProviders }, { liveStore }] = await Promise.all([
    import("@/lib/operator/providers"),
    import("@/lib/operator/store"),
  ]);
  const p = liveProviders();
  const store = liveStore();
  const deps: CloseBillingDeps = {
    stripeConfigured: p.configured.stripe,
    getSubscription: (id) => store.getSubscription(id),
    markSubscriptionStatus: (id, status) => store.markSubscriptionStatus(id, status),
    stripeCancel: (id, o) => p.stripeCancel(id, o),
    stripeOpenSubscriptionsFor: (id) => p.stripeOpenSubscriptionsFor(id),
    stripeSubscriptionsByClient: (id) => p.stripeSubscriptionsByClient(id),
  };
  const result = await cancelBillingOnClose(clientId, deps);
  if (result.status === "failed") {
    logger.error("account.close.billing_cancel_failed", { clientId, error: result.error });
  } else {
    logger.info("account.close.billing", { clientId, status: result.status, ids: "ids" in result ? result.ids : [] });
    if (result.status === "canceled") {
      void audit({ clientId, actor, action: "account.billing_canceled", detail: { subscriptions: result.ids } });
    }
  }
  return result;
}
