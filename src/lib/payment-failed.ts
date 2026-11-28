import { isSuspended } from "@/lib/operator/suspension";
import "server-only";
import type Stripe from "stripe";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { clients, subscriptions } from "@/db/schema";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import { notifier } from "@/lib/notifier";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Which business an invoice belongs to: subscription metadata, else our row for the customer. */
export async function clientIdForInvoice(invoice: Stripe.Invoice): Promise<string | null> {
  const fromMeta = invoice.parent?.subscription_details?.metadata?.clientId;
  if (fromMeta) return fromMeta;
  const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
  if (!customerId) return null;
  const [row] = await db
    .select({ clientId: subscriptions.clientId })
    .from(subscriptions)
    .where(eq(subscriptions.stripeCustomerId, customerId))
    .limit(1);
  return row?.clientId ?? null;
}

/**
 * invoice.payment_failed: tell the owner their card didn't go through and how
 * to fix it, before Stripe's retries run out and the receptionist stops.
 * Returns whether an email was attempted (false = unknown business / no email).
 */
export async function notifyPaymentFailed(invoice: Stripe.Invoice): Promise<boolean> {
  const clientId = await clientIdForInvoice(invoice);
  if (!clientId) {
    logger.warn("stripe.payment_failed.unknown_client", { invoiceId: invoice.id });
    return false;
  }
  const client = await getClientByIdUnsafe(clientId);
  const to = client?.ownerEmail;
  // An operator suspended or deleted this business: no "fix your card" emails.
  if (client && isSuspended(client)) return false;
  if (!client || !to) {
    logger.warn("stripe.payment_failed.no_owner_email", { clientId });
    return false;
  }
  const amount = `$${((invoice.amount_due ?? 0) / 100).toFixed(2)}`;
  const fixUrl = `${env.APP_URL}/portal/settings`;
  const retry = invoice.next_payment_attempt
    ? ` We'll try again on ${new Date(invoice.next_payment_attempt * 1000).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: client.timezone ?? "UTC" })}.`
    : "";
  await notifier.sendEmail({
    to,
    subject: "FrontDesk AI — your payment didn't go through",
    html:
      `<p>Hi ${esc(client.name)},</p>` +
      `<p>We couldn't charge your card for your FrontDesk AI subscription (${amount}).${esc(retry)}</p>` +
      `<p>To keep your AI receptionist answering, update your card: <a href="${fixUrl}">Settings → Billing → Manage billing</a>.</p>`,
    text:
      `Hi ${client.name},\n\nWe couldn't charge your card for your FrontDesk AI subscription (${amount}).${retry}\n\n` +
      `To keep your AI receptionist answering, update your card: ${fixUrl} (Settings → Billing → Manage billing).`,
  });
  await notifyAdminOnce(clientId, client, "paymentFailedInvoice", invoice.id ?? "unknown", {
    subject: `Payment failed: ${client.name} (${amount})`,
    text:
      `${client.name}'s card was declined for ${amount}.` +
      (invoice.next_payment_attempt
        ? ` Stripe retries on ${new Date(invoice.next_payment_attempt * 1000).toISOString().slice(0, 10)}.`
        : " Stripe has no more retries scheduled.") +
      ` The owner (${to}) has been emailed. Nothing is switched off while Stripe retries; if every retry fails and the subscription ends, the AI goes to messages-only.`,
  });
  return true;
}

type BillingAlertKey = "paymentFailedInvoice" | "holdNotifiedAt";

/**
 * One email to Ari (env.ALERT_EMAIL) per invoice / per hold. Stripe sends
 * invoice.payment_failed on every retry and may replay events; the owner gets
 * each retry's reminder, Ari gets one line per problem. The claim is atomic
 * (only the request that changes the stored value sends).
 */
async function notifyAdminOnce(
  clientId: string,
  client: { name: string },
  key: BillingAlertKey,
  value: string,
  msg: { subject: string; text: string },
): Promise<void> {
  const claimed = await db
    .update(clients)
    .set({
      setupFlags: sql`jsonb_set(coalesce(${clients.setupFlags}, '{}'::jsonb), '{billingAlerts}', coalesce(${clients.setupFlags}->'billingAlerts', '{}'::jsonb) || jsonb_build_object(${key}::text, ${value}::text))`,
    })
    .where(
      sql`${clients.id} = ${clientId} and coalesce(${clients.setupFlags}->'billingAlerts'->>${key}::text, '') <> ${value}`,
    )
    .returning({ id: clients.id });
  if (claimed.length === 0) return;
  try {
    await notifier.sendEmail({
      to: env.ALERT_EMAIL,
      subject: `FrontDesk billing — ${msg.subject}`,
      text: `${msg.text}\n\nBusiness: ${client.name} (${clientId})\n${env.APP_URL}/clients/${clientId}`,
      html: `<p>${esc(msg.text)}</p><p>Business: ${esc(client.name)} — <a href="${env.APP_URL}/clients/${clientId}">open in the dashboard</a></p>`,
    });
  } catch (err) {
    logger.warn("stripe.billing_alert.admin_email_failed", {
      clientId,
      key,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * The subscription of a live business ended (canceled, or Stripe "unpaid"):
 * its AI is now on the messages-only hold (billing-hold.ts). Tell the owner
 * what still works and how to turn it back on, and tell Ari — once per hold.
 */
export async function notifyBillingHold(
  clientId: string,
  reason: "canceled" | "unpaid",
  holdKey: string,
): Promise<void> {
  const client = await getClientByIdUnsafe(clientId);
  if (!client || isSuspended(client)) return;
  await notifyAdminOnce(clientId, client, "holdNotifiedAt", holdKey, {
    subject: `${client.name}'s plan ended (${reason})`,
    text:
      reason === "unpaid"
        ? `Every retry of ${client.name}'s payment failed and Stripe marked the subscription unpaid. The AI now only takes messages. The phone number is kept; release it from the dashboard if they don't come back.`
        : `${client.name}'s subscription was canceled (by the owner, or by Stripe after the payment retries ran out). The AI now only takes messages. The phone number is kept; release it from the dashboard if they don't come back.`,
  });
  const to = client.ownerEmail?.trim();
  if (!to) return;
  const fixUrl = `${env.APP_URL}/portal/settings`;
  const plansUrl = `${env.APP_URL}/portal/guidelines?plans=open#plans`;
  const lead =
    reason === "unpaid"
      ? "We couldn't collect your FrontDesk AI payment after several tries, so your plan is on hold."
      : "Your FrontDesk AI plan has ended.";
  const body = [
    lead,
    "Your AI still answers your line, but it only takes messages now: the caller's name, number and reason, sent to you. It doesn't book appointments or answer questions.",
    reason === "unpaid"
      ? `Update your card and everything is back within a minute: ${fixUrl} (Settings → Billing → Manage billing).`
      : `Pick a plan and everything is back within a minute: ${plansUrl}`,
    "If you don't plan to come back, undo your call forwarding (dial *73 from your business phone; AT&T/T-Mobile: ##21#) so your callers reach you directly.",
  ];
  try {
    await notifier.sendEmail({
      to,
      subject: reason === "unpaid" ? "FrontDesk AI — your plan is on hold" : "FrontDesk AI — your plan has ended",
      text: `Hi ${client.name},\n\n${body.join("\n\n")}`,
      html: `<p>Hi ${esc(client.name)},</p>${body.map((p) => `<p>${esc(p)}</p>`).join("")}`,
    });
  } catch (err) {
    logger.warn("stripe.billing_hold.owner_email_failed", {
      clientId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
