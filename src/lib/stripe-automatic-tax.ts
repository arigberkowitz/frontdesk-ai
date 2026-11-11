/**
 * Stripe Tax (automatic_tax) helpers.
 *
 * Off unless STRIPE_AUTOMATIC_TAX is exactly "on", so merging this code
 * collects no tax and changes no checkout fields. Live Stripe prices are
 * already tax-exclusive; when the flag is on, Checkout collects a billing
 * address (Stripe Tax needs a location) and the pricing copy says
 * "+ applicable tax".
 */

export const APPLICABLE_TAX_NOTE = "+ applicable tax";

export function isAutomaticTaxEnabled(
  value: string | undefined = process.env.STRIPE_AUTOMATIC_TAX,
): boolean {
  return value === "on";
}

/** Append "+ applicable tax" to a displayed price, once, when tax is on. */
export function withApplicableTax(label: string, enabled: boolean): string {
  if (!enabled || label.includes(APPLICABLE_TAX_NOTE)) return label;
  return `${label} ${APPLICABLE_TAX_NOTE}`;
}

type CheckoutTaxParams = {
  automatic_tax?: { enabled: true };
  billing_address_collection?: "required";
  customer_update?: { address: "auto"; name: "auto" };
};

/**
 * Spread onto Checkout Session create. New customers must give a billing
 * address; existing Stripe Customers also get customer_update so Stripe can
 * save that address for later tax calculation.
 */
export function checkoutAutomaticTaxParams(
  opts?: { hasCustomer?: boolean },
  enabled = isAutomaticTaxEnabled(),
): CheckoutTaxParams {
  if (!enabled) return {};
  if (opts?.hasCustomer) {
    return {
      automatic_tax: { enabled: true },
      billing_address_collection: "required",
      customer_update: { address: "auto", name: "auto" },
    };
  }
  return {
    automatic_tax: { enabled: true },
    billing_address_collection: "required",
  };
}

/** Spread onto Subscription create or update. */
export function subscriptionAutomaticTaxParams(
  enabled = isAutomaticTaxEnabled(),
): { automatic_tax?: { enabled: true } } {
  if (!enabled) return {};
  return { automatic_tax: { enabled: true } };
}

/**
 * Spread onto inline price_data. Named live prices already have
 * tax_behavior: "exclusive"; inline prices need the same once tax is on.
 */
export function inlinePriceTaxBehavior(
  enabled = isAutomaticTaxEnabled(),
): { tax_behavior?: "exclusive" } {
  if (!enabled) return {};
  return { tax_behavior: "exclusive" };
}
