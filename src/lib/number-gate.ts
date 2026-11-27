/**
 * When a business may get its own phone number.
 *
 * A number is a monthly vendor charge, so a business only gets one once it is
 * a paying customer. The receptionist itself (LLM + agent) is still built at
 * signup: it costs nothing until it's called, and it's what the browser test
 * call talks to. Only the NUMBER waits.
 *
 * A number unlocks when any of these is true:
 *   - an operator is doing it (the operator dashboard can always provision);
 *   - the business has paid: a recorded first payment over $0, or a Stripe
 *     subscription that is "active". "active" is the fallback for when the
 *     invoice events that record the payment are late or not delivered;
 *     a subscription only reaches "active" once its first invoice is settled.
 *     A Stripe "trialing" subscription — card on file, nothing charged yet —
 *     does not unlock it;
 *   - it's comped (someone we know, free on purpose);
 *   - it's "live" with no Stripe subscription at all: an operator set it live
 *     for a deal billed outside Stripe.
 *
 * Finishing setup and an operator-approved trial used to unlock it too. They
 * no longer do: both bought a number for a business that had paid nothing.
 *
 * Pure: the facts come from `data/number-gate.ts`, so the rules are testable.
 */

export type NumberUnlockVia = "operator" | "paid" | "comped" | "live";

export interface NumberGateFacts {
  /** Who is asking. "system" = a webhook acting on the business's own state. */
  actorRole: "operator" | "client_admin" | "client_viewer" | "system";
  status: string;
  comped: boolean;
  /** The business's Stripe subscription status, or null with none. */
  subscriptionStatus: string | null;
  /** Stripe has collected a real (over $0) payment from this business. */
  firstPaid: boolean;
}

export interface NumberGate {
  unlocked: boolean;
  via: NumberUnlockVia | null;
  /** Locked because a card is on file but the first charge is still ahead (Stripe trial). */
  awaitingFirstCharge: boolean;
}

export function numberGate(f: NumberGateFacts): NumberGate {
  const via: NumberUnlockVia | null =
    f.actorRole === "operator"
      ? "operator"
      : f.firstPaid || f.subscriptionStatus === "active"
        ? "paid"
        : f.comped
          ? "comped"
          : f.status === "live" && f.subscriptionStatus === null
            ? "live"
            : null;
  return {
    unlocked: via !== null,
    via,
    awaitingFirstCharge: via === null && f.subscriptionStatus === "trialing",
  };
}
