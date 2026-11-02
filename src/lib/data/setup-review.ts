import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import type { ReviewableStep } from "@/lib/setup-steps";
// Not a server action on purpose: no auth check of its own.

/**
 * Record that the owner has edited or confirmed a pre-filled setup step.
 * Called from the save actions on that step's page (callers have already
 * checked edit access) and from the checklist's "Looks good". A jsonb merge,
 * so it can't clobber another flag written at the same moment.
 */
export async function markSetupReviewed(clientId: string, key: ReviewableStep): Promise<void> {
  await db
    .update(clients)
    .set({
      setupFlags: sql`coalesce(${clients.setupFlags}, '{}'::jsonb) || jsonb_build_object('reviewed', coalesce(${clients.setupFlags}->'reviewed', '{}'::jsonb) || jsonb_build_object(${key}::text, true))`,
    })
    .where(eq(clients.id, clientId));
}
