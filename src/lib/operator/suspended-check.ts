import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";

/** Message shown to an owner whose company an operator suspended. Deliberately vague about why. */
export const SUSPENDED_MESSAGE =
  "This account is suspended. Please contact FrontDesk AI support to get it reactivated.";

/**
 * Is this business suspended by an operator, or deleted? One tiny query.
 * `strict` (owner-facing guards) lets a database error propagate rather than
 * guess; the notifier passes `strict: false` so a hiccup can't block a send.
 */
export async function isClientSuspended(clientId: string, opts: { strict?: boolean } = {}): Promise<boolean> {
  try {
    const [row] = await db
      .select({ flags: clients.setupFlags, deletedAt: clients.deletedAt })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);
    return Boolean(row && (row.deletedAt || row.flags?.suspended));
  } catch (err) {
    if (opts.strict) throw err;
    return false;
  }
}
