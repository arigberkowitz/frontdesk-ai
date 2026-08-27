/**
 * Deposits: ask for money before the slot is held.
 *
 * No-shows are the quiet leak in every appointment business, and a small
 * deposit is the only thing that reliably plugs it. Pure rules here, so the
 * decision of who gets asked is testable without a payment provider.
 *
 * WHAT THIS DELIBERATELY IS NOT: a checkout we run. The Stripe account in this
 * codebase belongs to the operator, so putting a dentist's deposits through it
 * would mean holding customer money on a business's behalf — a regulated
 * activity, not a feature flag. The correct version is Stripe Connect with
 * each business onboarding its own account. Until that exists, the business
 * brings its own payment link, we send it at the moment it does the most good,
 * and the money never touches us.
 */

/** Below this a deposit costs more in friction than it saves in no-shows. */
export const MIN_DEPOSIT_CENTS = 500;
/** A deposit larger than this isn't a deposit, it's prepayment — and a caller
 *  asked for it over the phone by a robot will simply not pay it. */
export const MAX_DEPOSIT_CENTS = 50_000;

export interface DepositDecision {
  /** Should we ask this booking for a deposit? */
  required: boolean;
  amountCents: number | null;
  reason:
    | "asked"
    | "deposits_off"
    | "no_link"
    | "service_has_no_deposit"
    | "amount_out_of_range";
}

export function decideDeposit(input: {
  depositsEnabled: boolean;
  depositLinkUrl: string | null;
  serviceDepositCents: number | null;
}): DepositDecision {
  if (!input.depositsEnabled) return { required: false, amountCents: null, reason: "deposits_off" };
  // No link means nowhere to send them, and a text asking for a deposit with no
  // way to pay it is worse than no text.
  if (!input.depositLinkUrl?.trim()) {
    return { required: false, amountCents: null, reason: "no_link" };
  }
  const cents = input.serviceDepositCents;
  if (cents == null || cents <= 0) {
    return { required: false, amountCents: null, reason: "service_has_no_deposit" };
  }
  if (cents < MIN_DEPOSIT_CENTS || cents > MAX_DEPOSIT_CENTS) {
    return { required: false, amountCents: null, reason: "amount_out_of_range" };
  }
  return { required: true, amountCents: cents, reason: "asked" };
}

/**
 * The deposit text. Templated, never model-written.
 *
 * It names the amount and the appointment, and it is careful about what it
 * promises: the slot IS booked. Threatening to drop the booking if they don't
 * pay within an hour is a good way to lose a customer who was going to show up
 * anyway, and this product has no way to enforce it.
 */
export function depositRequestBody(input: {
  businessName: string;
  customerName: string | null;
  amountCents: number;
  when: string;
  payUrl: string;
}): string {
  const clean = (v: string | null, max: number) =>
    (v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const name = clean(input.customerName, 40);
  const business = clean(input.businessName, 60);
  const amount = formatDeposit(input.amountCents);

  return (
    `Hi${name ? ` ${name}` : ""}, you're booked with ${business} for ${input.when}. ` +
    `A ${amount} deposit secures the slot: ${input.payUrl}` +
    ` Reply STOP to opt out.`
  );
}

/** "$25" for whole dollars, "$27.50" otherwise. */
export function formatDeposit(cents: number): string {
  return cents % 100 === 0
    ? `$${cents / 100}`
    : `$${(cents / 100).toFixed(2)}`;
}
