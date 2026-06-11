/**
 * One-time Stripe setup. Creates a 100%-off "comp" promo code and the webhook
 * endpoint pointing at your deployed app, then prints the values you paste into
 * Vercel. Safe to re-run (reuses an existing code of the same name).
 *
 * Run with your Stripe TEST secret key (so nothing real is charged):
 *   STRIPE_SECRET_KEY=sk_test_xxx \
 *   APP_URL=https://frontdesk-ai-alpha.vercel.app \
 *   PROMO_CODE=FOUNDER \
 *   npx tsx scripts/setup-stripe.ts
 *
 * Switch to live later by re-running with your sk_live_ key.
 */
import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY;
const appUrl = (process.env.APP_URL ?? "https://frontdesk-ai-alpha.vercel.app").replace(/\/$/, "");
const code = (process.env.PROMO_CODE ?? "FOUNDER").toUpperCase();

if (!key) {
  console.error("Set STRIPE_SECRET_KEY (use your TEST key, sk_test_…). Aborting.");
  process.exit(1);
}
const stripe = new Stripe(key);
const mode = key.startsWith("sk_live_") ? "LIVE" : "TEST";

async function main(): Promise<void> {
  console.log(`\nSetting up Stripe in ${mode} mode…\n`);

  // 1) 100%-off coupon + a shareable promotion code.
  const existing = await stripe.promotionCodes.list({ code, limit: 1 });
  let promoCode = existing.data[0]?.code;
  if (!promoCode) {
    const coupon = await stripe.coupons.create({
      percent_off: 100,
      duration: "forever",
      name: "100% off (comp)",
    });
    const promo = await stripe.promotionCodes.create({
      coupon: coupon.id,
      code,
    } as unknown as Stripe.PromotionCodeCreateParams);
    promoCode = promo.code;
  }
  console.log(`✓ Promo code:  ${promoCode}   (100% off — share it for a free account)`);

  // 2) Webhook endpoint → your deployed app.
  const url = `${appUrl}/api/webhooks/stripe`;
  const endpoint = await stripe.webhookEndpoints.create({
    url,
    enabled_events: [
      "checkout.session.completed",
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted",
    ],
  });
  console.log(`✓ Webhook:     ${url}`);
  console.log(`\nAdd these to Vercel (Project → Settings → Environment Variables), then redeploy:`);
  console.log(`  STRIPE_SECRET_KEY=${(key as string).slice(0, 12)}…   (the key you ran this with)`);
  console.log(`  STRIPE_WEBHOOK_SECRET=${endpoint.secret}\n`);
  console.log(`Then test a checkout with card 4242 4242 4242 4242 (any future date / CVC / ZIP).\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
