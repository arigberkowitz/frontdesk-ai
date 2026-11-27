import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { numberGate, type NumberGate, type NumberGateFacts } from "@/lib/number-gate";

/** Whether this business may be given its own phone number (see number-gate.ts). */
export async function getNumberGate(
  clientId: string,
  actorRole: NumberGateFacts["actorRole"],
): Promise<NumberGate & { firstChargeAt: Date | null }> {
  const client = await db.query.clients.findFirst({
    where: and(eq(clients.id, clientId), isNull(clients.deletedAt)),
    with: { subscription: true },
  });
  if (!client) return { unlocked: false, via: null, awaitingFirstCharge: false, firstChargeAt: null };
  const sub = client.subscription;
  const gate = numberGate({
    actorRole,
    status: client.status,
    comped: Boolean(client.setupFlags?.comped),
    // A soft-deleted subscription row is no subscription.
    subscriptionStatus: sub && !sub.deletedAt ? sub.status : null,
    firstPaid: Boolean(sub && !sub.deletedAt && sub.firstPaidAt),
  });
  // On a Stripe trial the period ends when the trial does: that's the first charge.
  return { ...gate, firstChargeAt: gate.awaitingFirstCharge ? (sub?.currentPeriodEnd ?? null) : null };
}
