import type Stripe from "stripe";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";
import { getStripe, subscriptionPeriodEnd } from "@/lib/stripe";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { PLANS, type PlanKey } from "@/config/plans";

export const runtime = "nodejs";

type SubStatus = (typeof subscriptions.$inferInsert)["status"];

/** Map Stripe's subscription status onto our enum. */
function mapStatus(s: Stripe.Subscription.Status): SubStatus {
  switch (s) {
    case "trialing":
    case "active":
    case "past_due":
    case "canceled":
    case "paused":
    case "incomplete":
      return s;
    case "unpaid":
      return "past_due";
    case "incomplete_expired":
      return "canceled";
    default:
      return "incomplete";
  }
}

async function upsert(clientId: string, sub: Stripe.Subscription): Promise<void> {
  const planKey = sub.metadata?.plan as PlanKey | undefined;
  const plan = planKey ? PLANS[planKey] : undefined;
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;

  const values = {
    clientId,
    stripeCustomerId: customerId,
    stripeSubscriptionId: sub.id,
    plan: planKey ?? null,
    monthlyPriceCents: plan?.monthlyPriceCents ?? null,
    setupFeeCents: plan?.setupFeeCents ?? null,
    status: mapStatus(sub.status),
    currentPeriodEnd: subscriptionPeriodEnd(sub),
  };

  await db
    .insert(subscriptions)
    .values(values)
    .onConflictDoUpdate({ target: subscriptions.clientId, set: values });
}

/**
 * Stripe webhook (§EPIC A4). Signature-verified; keeps the `subscriptions` table
 * in sync with checkout completions and subscription lifecycle events.
 */
export async function POST(req: Request): Promise<Response> {
  const sig = req.headers.get("stripe-signature");
  if (!sig || !env.STRIPE_WEBHOOK_SECRET) {
    return new Response("Stripe webhook not configured", { status: 400 });
  }

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, sig, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    logger.error("stripe.webhook.bad_signature", {
      error: err instanceof Error ? err.message : String(err),
    });
    return new Response("Invalid signature", { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const clientId = session.metadata?.clientId;
      if (clientId && session.subscription) {
        const subId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
        const sub = await getStripe().subscriptions.retrieve(subId);
        await upsert(clientId, sub);
      }
    } else if (event.type.startsWith("customer.subscription.")) {
      const sub = event.data.object as Stripe.Subscription;
      const clientId = sub.metadata?.clientId;
      if (clientId) await upsert(clientId, sub);
    }
  } catch (err) {
    logger.error("stripe.webhook.handler_failed", {
      type: event.type,
      eventId: event.id,
      error: err instanceof Error ? err.message : String(err),
    });
    // Stripe retries a 500 with backoff for up to three days. That is exactly
    // what we want here: these events carry whether a business is paying. A 200
    // told Stripe "recorded" and threw the only copy away, so a transient blip
    // during checkout left a paying customer marked unpaid, permanently, and
    // the only trace was a line in a log nobody reads.
    return new Response("Handler failed", { status: 500 });
  }

  return new Response("ok", { status: 200 });
}
