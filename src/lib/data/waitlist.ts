import "server-only";
import { and, asc, eq, gte, isNull } from "drizzle-orm";
import { db } from "@/db";
import { waitlistEntries, type NewWaitlistEntry, type WaitlistEntry } from "@/db/schema";

export async function addWaitlistEntry(
  clientId: string,
  input: Omit<NewWaitlistEntry, "clientId" | "id">,
): Promise<WaitlistEntry> {
  const [row] = await db.insert(waitlistEntries).values({ ...input, clientId }).returning();
  if (!row) throw new Error("Failed to add waitlist entry");
  return row;
}

/** Everyone still waiting whose window hasn't closed. */
export async function listWaiting(clientId: string, now = new Date()): Promise<WaitlistEntry[]> {
  return db.query.waitlistEntries.findMany({
    where: and(
      eq(waitlistEntries.clientId, clientId),
      eq(waitlistEntries.status, "waiting"),
      gte(waitlistEntries.latestAt, now),
      isNull(waitlistEntries.deletedAt),
    ),
    orderBy: [asc(waitlistEntries.createdAt)],
    limit: 200,
  });
}

/** The whole list an owner should see, live and recent, newest window first. */
export async function listWaitlistForClient(clientId: string): Promise<WaitlistEntry[]> {
  return db.query.waitlistEntries.findMany({
    where: and(eq(waitlistEntries.clientId, clientId), isNull(waitlistEntries.deletedAt)),
    orderBy: [asc(waitlistEntries.earliestAt)],
    limit: 200,
  });
}

export async function markOffered(id: string, clientId: string): Promise<void> {
  const row = await db.query.waitlistEntries.findFirst({
    where: and(eq(waitlistEntries.id, id), eq(waitlistEntries.clientId, clientId)),
  });
  if (!row) return;
  await db
    .update(waitlistEntries)
    .set({
      status: "notified",
      notifiedAt: new Date(),
      notifyCount: row.notifyCount + 1,
    })
    .where(and(eq(waitlistEntries.id, id), eq(waitlistEntries.clientId, clientId)));
}

/**
 * Put a notified entry back in the pool.
 *
 * "Notified" is not a terminal state — we told them about one opening and
 * nobody replied. Leaving them stuck there would mean the second cancellation
 * of the week reaches nobody, which is exactly the case this feature exists
 * for. The offer cap is what stops this from becoming a nuisance.
 */
export async function requeueUnclaimed(clientId: string, olderThanHours = 24): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanHours * 3_600_000);
  const rows = await db.query.waitlistEntries.findMany({
    where: and(
      eq(waitlistEntries.clientId, clientId),
      eq(waitlistEntries.status, "notified"),
      isNull(waitlistEntries.deletedAt),
    ),
  });
  let n = 0;
  for (const row of rows) {
    if (!row.notifiedAt || row.notifiedAt > cutoff) continue;
    if (row.latestAt < new Date()) continue;
    await db
      .update(waitlistEntries)
      .set({ status: "waiting" })
      .where(eq(waitlistEntries.id, row.id));
    n += 1;
  }
  return n;
}

export async function setWaitlistStatus(
  clientId: string,
  id: string,
  status: "waiting" | "booked" | "cancelled" | "expired",
): Promise<void> {
  await db
    .update(waitlistEntries)
    .set({ status })
    .where(and(eq(waitlistEntries.id, id), eq(waitlistEntries.clientId, clientId)));
}
