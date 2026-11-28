import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { businessHours, calls } from "@/db/schema";

/**
 * The real number behind the locked website-chat card's pitch: inbound calls
 * that came in while the business was closed, last `days` days.
 *
 * Uses the `calls.is_after_hours` flag the Retell webhook stamps (same source
 * as the "While you were closed" card), excluding spam. Missed calls count:
 * somebody still tried to reach the business while it was closed, which is
 * the point being made. Null when the business has no hours saved (nothing is
 * ever flagged, so a "0" would be a lie) or the query fails; the card then
 * uses a plain line with no number.
 */
export async function countAfterHoursCalls(clientId: string, days = 30): Promise<number | null> {
  try {
    const [hours] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(businessHours)
      .where(eq(businessHours.clientId, clientId));
    if (!hours || hours.n === 0) return null;
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(calls)
      .where(
        and(
          eq(calls.clientId, clientId),
          isNull(calls.deletedAt),
          eq(calls.direction, "inbound"),
          eq(calls.isAfterHours, true),
          sql`coalesce(${calls.outcome}::text, '') <> 'spam'`,
          sql`${calls.startAt} >= now() - make_interval(days => ${days}::int)`,
        ),
      );
    return row?.n ?? 0;
  } catch {
    return null;
  }
}
