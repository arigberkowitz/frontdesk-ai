import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";

/** How long a first-provision lock holds before it's treated as abandoned. */
const PROVISION_LOCK_MINUTES = 3;

/**
 * Claim the right to run a business's FIRST provision (the one that buys a
 * phone number). Two concurrent runs used to both see "no number yet" and
 * both buy one; a double-clicked Activate was enough. Atomic: one UPDATE that
 * only matches while no number is stored and no fresh lock is held.
 */
export async function claimFirstProvision(clientId: string): Promise<boolean> {
  const rows = await db
    .update(clients)
    .set({
      setupFlags: sql`${clients.setupFlags} || jsonb_build_object('provisioningAt', ${new Date().toISOString()}::text)`,
    })
    .where(
      and(
        eq(clients.id, clientId),
        isNull(clients.retellPhoneNumber),
        sql`(${clients.setupFlags}->>'provisioningAt' is null or (${clients.setupFlags}->>'provisioningAt')::timestamptz < now() - make_interval(mins => ${PROVISION_LOCK_MINUTES}))`,
      ),
    )
    .returning({ id: clients.id });
  return rows.length > 0;
}

export async function releaseFirstProvision(clientId: string): Promise<void> {
  await db
    .update(clients)
    .set({ setupFlags: sql`${clients.setupFlags} - 'provisioningAt'` })
    .where(eq(clients.id, clientId));
}

