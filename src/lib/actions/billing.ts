"use server";

import { redirect } from "next/navigation";
import { audit } from "@/lib/data/audit";
import { requireClientEditor, requireOperator } from "@/lib/auth-guard";
import { assertClientInOrg, getClient } from "@/lib/data/clients";
import { getStripe } from "@/lib/stripe";
import { env, integrations } from "@/lib/env";
import { logger } from "@/lib/logger";
import { PLANS, type PlanKey } from "@/config/plans";
import { type ActionState } from "./types";

/**
 * Stripe's tax code for business-use SaaS.
 *
 * Stripe Tax is on by default for accounts created now, and it refuses any
 * inline price whose product has no tax code: "Invalid line_items[0]: the
 * product tax code is missing." Every checkout attempt came back 400 and the
 * customer saw "Couldn't open the payment page", which describes nothing.
 */
const SAAS_TAX_CODE = "txcd_10103001";

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
            product_data: {
              name: `FrontDesk AI — ${plan.name} (${interval}ly)`,
              tax_code: SAAS_TAX_CODE,
            },
          },
        },
        ...(plan.setupFeeCents > 0
          ? [
              {
                quantity: 1,
                price_data: {
                  currency: "usd",
                  unit_amount: plan.setupFeeCents,
                  product_data: { name: "One-time setup fee", tax_code: SAAS_TAX_CODE },
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

/**
 * The business pays for itself.
 *
 * Until now there was no route from "signed up on the website" to "live". The
 * only checkout in the product was operator-gated, so the four plans on the
 * pricing page were dead ends for exactly the person reading them: a stranger
 * clicked "Get started free", built their whole receptionist, pressed Activate,
 * and was asked for a code nobody had given them.
 *
 * The setup fee is deliberately not charged here. It exists to cover setting a
 * business up, and this business is setting itself up — asking someone who
 * found you on the internet for $1,500 before they have heard a single call is
 * how you get a pricing page nobody completes. It still applies to deals closed
 * in person, through the operator checkout above.
 */
export async function startSelfServeCheckoutAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const planKey = String(formData.get("plan") ?? "") as PlanKey;
  const interval = String(formData.get("interval") ?? "month") === "year" ? "year" : "month";

  // The business's own owner/admin — not their staff, and not another tenant.
  const guard = await requireClientEditor(clientId);
  if (!guard.ok) return { ok: false, error: guard.error };
  await assertClientInOrg(guard.user.orgId, clientId);

  if (!integrations.stripe()) {
    return {
      ok: false,
      error: "Card payments aren't switched on yet. Get in touch and we'll sort it out.",
    };
  }
  const plan = PLANS[planKey];
  if (!plan) return { ok: false, error: "Pick a plan first." };

  const client = await getClient(guard.user.orgId, clientId);
  if (!client) return { ok: false, error: "Client not found." };

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
            product_data: {
              name: `FrontDesk AI — ${plan.name} (${interval}ly)`,
              tax_code: SAAS_TAX_CODE,
            },
          },
        },
      ],
      allow_promotion_codes: true,
      customer_email: client.ownerEmail || undefined,
      success_url: `${env.APP_URL}/portal/guidelines?billing=success`,
      cancel_url: `${env.APP_URL}/portal/guidelines?billing=cancel`,
      metadata: { clientId, plan: planKey, interval, selfServe: "true" },
      subscription_data: { metadata: { clientId, plan: planKey } },
    });
    url = session.url;
    void audit({ clientId, actor: guard.user.id, action: "billing.checkout_opened", detail: { plan: planKey, interval } });
  } catch (err) {
    logger.error("billing.self_serve_checkout.failed", {
      clientId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: "Couldn't open the payment page. Try again in a moment." };
  }

  if (!url) return { ok: false, error: "Couldn't open the payment page — please try again." };
  redirect(url);
}
