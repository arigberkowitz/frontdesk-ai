import type Stripe from "stripe";
import { after } from "next/server";
import { db } from "@/db";
import { clients, subscriptions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { planSyncPatch, resolvePlanKey } from "@/lib/plan-sync";
import { getStripe, subscriptionPeriodEnd } from "@/lib/stripe";
import {
  getWebhookEventStatus,
  markWebhookProcessed,
  recordWebhookEvent,
} from "@/lib/data/webhook-events";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { PLANS, type PlanKey } from "@/config/plans";
import { planFromPriceId } from "@/lib/stripe-prices";
import { provisionNumberAfterPayment } from "@/lib/provision";
import { notifyPaymentFailed } from "@/lib/payment-failed";

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

async function upsert(clientId: string, sub: Stripe.Subscription): Promise<SubStatus> {
  // Metadata first (every checkout we open sets it); then the Price ID
  // (maps monthly and yearly prices to the same plan); then amount/interval.
  const item = sub.items?.data?.[0]?.price;
  const planKey: PlanKey | undefined =
    resolvePlanKey(sub.metadata?.plan, item ? { unitAmount: item.unit_amount, interval: item.recurring?.interval } : null) ??
    planFromPriceId(item?.id) ??
    undefined;
  const plan = planKey ? PLANS[planKey] : undefined;
  const [previous] = await db
    .select({ plan: subscriptions.plan })
    .from(subscriptions)
    .where(eq(subscriptions.clientId, clientId))
    .limit(1);
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
  await applyPlanToClient(clientId, planKey ?? null, values.status ?? "incomplete", previous?.plan ?? null);
  return values.status;
}

/**
 * Make the business match what it bought: live (so gates bind), Rescue on
 * missed-only answering, staff mode only on Pro, Spanish on Starter and up —
 * then republish the live agent so the phone line matches too.
 */
async function applyPlanToClient(
  clientId: string,
  plan: PlanKey | null,
  subStatus: string,
  previousPlan: string | null,
): Promise<void> {
  const client = await db.query.clients.findFirst({ where: eq(clients.id, clientId) });
  if (!client) return;
  const patch = planSyncPatch(
    {
      status: client.status,
      comped: Boolean(client.setupFlags?.comped),
      answeringMode: client.answeringMode,
      staffModeEnabled: client.staffModeEnabled,
      languages: client.languages,
    },
    plan,
    subStatus,
    previousPlan,
  );
  const changed = Object.keys(patch).length > 0;
  if (changed) {
    await db.update(clients).set(patch).where(eq(clients.id, clientId));
    logger.info("stripe.webhook.plan_applied", { clientId, plan, patch });
  }
  if (changed || previousPlan !== plan) {
    const orgId = client.orgId;
    // Lazy: agent-publish pulls in the whole calendar/voice stack.
    after(() =>
      import("@/lib/agent-publish")
        .then(({ syncAgentPrompt }) => syncAgentPrompt(orgId, clientId))
        .catch((err) =>
        logger.warn("stripe.webhook.agent_resync_failed", {
          clientId,
          error: err instanceof Error ? err.message : String(err),
        }),
      ),
    );
  }
}

/**
 * A self-serve business's phone number waits for a card (number-gate.ts). The
 * moment one is on file, hand it over — after the response, so Stripe isn't
 * kept waiting on the voice vendor. Idempotent: a business that already has a
 * number is skipped, and the first-provision lock stops a replay buying twice.
 */
function unlockNumberIfPaid(clientId: string, status: SubStatus): void {
  if (status !== "active" && status !== "trialing") return;
  after(() =>
    provisionNumberAfterPayment(clientId).catch((err) =>
      logger.warn("stripe.webhook.number_after_payment_failed", {
        clientId,
        error: err instanceof Error ? err.message : String(err),
      }),
    ),
  );
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

  // Same ledger the Retell webhook keeps: one row per event. These events
  // decide whether a business is paying — the one category of webhook where
  // "we have no record of receiving it" is an unacceptable answer during a
  // billing dispute.
  //
  // Only an event that was actually HANDLED short-circuits. The row used to be
  // written before processing and every replay was skipped on sight, so when
  // the handler failed and returned 500, each of Stripe's retries hit the
  // ledger, got "200 already processed", and the event was lost for good. Now a
  // row left at "received"/"failed" is processed again; the upsert below is
  // idempotent, so a replay racing an in-flight first attempt is harmless.
  const { isNew } = await recordWebhookEvent({
    source: "stripe",
    externalId: event.id,
    eventType: event.type,
    payload: event,
  });
  if (!isNew) {
    const status = await getWebhookEventStatus("stripe", event.id);
    if (status === "processed" || status === "ignored") {
      return new Response("ok (already processed)", { status: 200 });
    }
    logger.info("stripe.webhook.reprocessing", { eventId: event.id, previousStatus: status });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const clientId = session.metadata?.clientId;
      if (clientId && session.subscription) {
        const subId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
        const sub = await getStripe().subscriptions.retrieve(subId);
        unlockNumberIfPaid(clientId, await upsert(clientId, sub));
      }
    } else if (event.type.startsWith("customer.subscription.")) {
      const sub = event.data.object as Stripe.Subscription;
      const clientId = sub.metadata?.clientId;
      if (clientId) unlockNumberIfPaid(clientId, await upsert(clientId, sub));
    } else if (event.type === "invoice.payment_failed") {
      // Status itself arrives as customer.subscription.updated (past_due);
      // this is the owner's heads-up so they can fix the card in time.
      await notifyPaymentFailed(event.data.object);
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
    // Keep the receipt but mark it failed, so the retry is processed rather
    // than short-circuited as a duplicate. A ledger hiccup here must not turn
    // the 500 into something else.
    await markWebhookProcessed("stripe", event.id, "failed").catch(() => undefined);
    return new Response("Handler failed", { status: 500 });
  }

  await markWebhookProcessed("stripe", event.id, "processed");
  return new Response("ok", { status: 200 });
}
