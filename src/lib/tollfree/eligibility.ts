/**
 * When a business may be bought a toll-free texting number.
 *
 * The number is a monthly Twilio charge per business, so it waits for a
 * business that is actually going to use it: one that has FINISHED SETUP
 * (owner clicked "I'm done" — `clients.setup_completed_at`) and is paying
 * (an active or trialing Stripe subscription, i.e. a card on file) or comped.
 *
 * Paying alone is not enough: a card on file with an unfinished setup used to
 * buy a number the business might never use. Finishing setup alone is not
 * enough either: the free, no-card path must never cost us a number.
 *
 * Pure, so the rules are testable; the facts come from TollfreeStore.client().
 */
export interface TollfreePurchaseFacts {
  /** clients.status: draft | trial | live | paused | churned. */
  status: string;
  /** The business already texts from its own number: never buy a second. */
  smsNumber: string | null;
  setupCompletedAt: Date | null;
  comped: boolean;
  /** The business's Stripe subscription status, or null with none. */
  subscriptionStatus: string | null;
}

export type TollfreeBlocker = "inactive" | "has_sms_number" | "setup_not_finished" | "not_paying";

const INACTIVE = new Set(["paused", "churned"]);
const PAYING = new Set(["active", "trialing"]);

/** null = OK to buy; otherwise why not. */
export function tollfreePurchaseBlocker(f: TollfreePurchaseFacts): TollfreeBlocker | null {
  if (INACTIVE.has(f.status)) return "inactive";
  if (f.smsNumber) return "has_sms_number";
  if (!f.setupCompletedAt) return "setup_not_finished";
  if (!f.comped && !PAYING.has(f.subscriptionStatus ?? "")) return "not_paying";
  return null;
}
