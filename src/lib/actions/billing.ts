"use server";

import { redirect } from "next/navigation";
import { requireOperator } from "@/lib/auth-guard";
import { getClient } from "@/lib/data/clients";
import { getStripe } from "@/lib/stripe";
import { env, integrations } from "@/lib/env";
import { logger } from "@/lib/logger";
import { PLANS, type PlanKey } from "@/config/plans";
import { type ActionState } from "./types";

/**
 * Start a Stripe Checkout for a client: the monthly (or yearly) subscription plus
 * the one-time setup fee, with promo codes enabled so a 100%-off code makes it
 * free. Redirects to Stripe's hosted checkout. The webhook records the result.
 */
export async function startCheckoutAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireOperator();
  const clientId = String(formData.get("clientId") ?? "");
  const planKey = String(formData.get("plan") ?? "") as PlanKey;
  const interval = String(formData.get("interval") ?? "month") === "year" ? "year" : "month";

  if (!integrations.stripe()) {
    return { ok: false, error: "Add your Stripe key in Settings to enable billing." };
  }
  const plan = PLANS[planKey];
  if (!plan) return { ok: false, error: "Pick a plan first." };

  const client = await getClient(user.orgId, clientId);
  if (!client) return { ok: false, error: "Client not found." };

  // Yearly = 10 months' price (two months free).
  const recurringAmount = interval === "year" ? plan.monthlyPriceCents * 10 : plan.monthlyPriceCents;

  let url: string | null = null;
  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: recurringAmount,
            recurring: { interval },
            product_data: { name: `FrontDesk AI — ${plan.name} (${interval}ly)` },
          },
        },
        ...(plan.setupFeeCents > 0
          ? [
              {
                quantity: 1,
                price_data: {
                  currency: "usd",
                  unit_amount: plan.setupFeeCents,
                  product_data: { name: "One-time setup fee" },
                },
              },
            ]
          : []),
      ],
      allow_promotion_codes: true,
      customer_email: client.ownerEmail || undefined,
      success_url: `${env.APP_URL}/clients/${clientId}?billing=success`,
      cancel_url: `${env.APP_URL}/clients/${clientId}?billing=cancel`,
      metadata: { clientId, plan: planKey, interval },
      subscription_data: { metadata: { clientId, plan: planKey } },
    });
    url = session.url;
  } catch (err) {
    logger.error("billing.checkout.failed", {
      clientId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: "Couldn't start checkout. Check your Stripe key and try again." };
  }

  if (!url) return { ok: false, error: "Couldn't start checkout — please try again." };
  redirect(url);
}
