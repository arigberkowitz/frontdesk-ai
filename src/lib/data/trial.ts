import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";

/**
 * May this client self-serve activate (provision) its receptionist?
 * True on an approved trial, a live plan, or an active/trialing subscription.
 */
export async function clientMayActivate(clientId: string): Promise<boolean> {
  const client = await db.query.clients.findFirst({
    where: and(eq(clients.id, clientId), isNull(clients.deletedAt)),
    with: { subscription: true },
  });
  if (!client) return false;
  if (client.status === "trial" || client.status === "live") return true;
  const sub = client.subscription;
  return Boolean(sub && (sub.status === "active" || sub.status === "trialing"));
}
