import "server-only";
import { and, eq, isNull, lt } from "drizzle-orm";
import { db } from "@/db";
import { clients, waitlistEntries } from "@/db/schema";
import { requeueUnclaimed } from "@/lib/data/waitlist";
import { logger } from "@/lib/logger";

/**
 * Daily waitlist bookkeeping. Sends nothing; just keeps the list honest.
 *
 * Two jobs. Entries whose window has passed become `expired`, so an owner
 * looking at the list sees who is actually still waiting rather than a museum
 * of last month's requests. And entries we told about an opening that nobody
 * claimed go back to `waiting` — "notified" is not a terminal state, it means
 * we mentioned one slot and heard nothing. Leaving them stuck there would mean
 * the second cancellation of the week reaches no one, which is precisely the
 * case this feature exists for. The per-entry offer cap is what keeps this
 * from becoming a nuisance.
 */
export async function runWaitlistHousekeeping(): Promise<{
  expired: number;
  requeued: number;
}> {
  const now = new Date();
  const expiredRows = await db
    .update(waitlistEntries)
    .set({ status: "expired" })
    .where(
      and(
        lt(waitlistEntries.latestAt, now),
        eq(waitlistEntries.status, "waiting"),
        isNull(waitlistEntries.deletedAt),
      ),
    )
    .returning({ id: waitlistEntries.id });

  const active = await db.query.clients.findMany({
    where: and(eq(clients.waitlistEnabled, true), isNull(clients.deletedAt)),
    columns: { id: true },
  });
  let requeued = 0;
  for (const c of active) requeued += await requeueUnclaimed(c.id);

  logger.info("waitlist.housekeeping", { expired: expiredRows.length, requeued });
  return { expired: expiredRows.length, requeued };
}
