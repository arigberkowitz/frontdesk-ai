import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { getClientSetupStatus } from "@/lib/data/setup";
import { numberGate, type NumberGate, type NumberGateFacts } from "@/lib/number-gate";

/** Whether this business may be given its own phone number (see number-gate.ts). */
export async function getNumberGate(
  clientId: string,
  actorRole: NumberGateFacts["actorRole"],
): Promise<NumberGate> {
  const client = await db.query.clients.findFirst({
    where: and(eq(clients.id, clientId), isNull(clients.deletedAt)),
    with: { subscription: true },
  });
  if (!client) return { unlocked: false, via: null, setupStepsLeft: [] };
  // Operators never need the checklist read.
  if (actorRole === "operator") return { unlocked: true, via: "operator", setupStepsLeft: [] };
  const setup = await getClientSetupStatus(clientId);
  return numberGate({
    actorRole,
    status: client.status,
    comped: Boolean(client.setupFlags?.comped),
    subscriptionStatus: client.subscription?.status ?? null,
    trialApproved: Boolean(client.setupFlags?.trialApprovedAt),
    steps: setup.steps,
  });
}
