import "server-only";
import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import { notifier } from "@/lib/notifier";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Which business an invoice belongs to: subscription metadata, else our row for the customer. */
async function clientIdFor(invoice: Stripe.Invoice): Promise<string | null> {
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
  const clientId = await clientIdFor(invoice);
  if (!clientId) {
    logger.warn("stripe.payment_failed.unknown_client", { invoiceId: invoice.id });
    return false;
  }
  const client = await getClientByIdUnsafe(clientId);
  const to = client?.ownerEmail;
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
  return true;
}
