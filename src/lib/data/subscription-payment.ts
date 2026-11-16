import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";

/**
 * True when Stripe collected a real payment, not a $0 invoice from a
 * 100%-off promo (status can still be "active" on those).
 */
export function isRealPayment(amountPaidCents: number | null | undefined): boolean {
  return (amountPaidCents ?? 0) > 0;
}

/**
 * Remember that this business has paid a real amount, once. Later $0
 * invoices (or webhook replays) leave the timestamp alone. Returns true
 * only when this call is for a real payment and a subscription row exists
 * to update.
 */
export async function recordFirstPayment(
  clientId: string,
  amountPaidCents: number | null | undefined,
): Promise<boolean> {
  if (!isRealPayment(amountPaidCents)) return false;
  const rows = await db
    .update(subscriptions)
    .set({ firstPaidAt: sql`coalesce(${subscriptions.firstPaidAt}, now())` })
    .where(and(eq(subscriptions.clientId, clientId), isNull(subscriptions.deletedAt)))
    .returning({ id: subscriptions.id });
  return rows.length > 0;
}
