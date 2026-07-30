import "server-only";
import { and, eq, gte, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { availabilityBlocks, type AvailabilityBlock } from "@/db/schema";

/**
 * Blocks that could still affect future bookings: every recurring rule, plus
 * one-off windows that haven't finished yet. Past closures are dead weight and
 * are left out of the availability math.
 */
export async function listActiveBlocks(clientId: string): Promise<AvailabilityBlock[]> {
  return db.query.availabilityBlocks.findMany({
    where: and(
      eq(availabilityBlocks.clientId, clientId),
      or(isNull(availabilityBlocks.endsAt), gte(availabilityBlocks.endsAt, new Date())),
    ),
    orderBy: (b, { asc }) => [asc(b.startsAt), asc(b.dayOfWeek), asc(b.startTime)],
  });
}

/** Everything the owner has set, including expired one-offs, for the settings UI. */
export async function listAllBlocks(clientId: string): Promise<AvailabilityBlock[]> {
  return db.query.availabilityBlocks.findMany({
    where: eq(availabilityBlocks.clientId, clientId),
    orderBy: (b, { asc }) => [asc(b.startsAt), asc(b.dayOfWeek), asc(b.startTime)],
  });
}
