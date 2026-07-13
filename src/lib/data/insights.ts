import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { callInsights, type CallInsight } from "@/db/schema";

/** Call-insight data access. Callers verify client→org ownership first. */

export async function getInsightForCall(
  clientId: string,
  callId: string,
): Promise<CallInsight | null> {
  // Fail-soft on a lagging migration — call pages render without insights.
  try {
    const row = await db.query.callInsights.findFirst({
      where: and(eq(callInsights.clientId, clientId), eq(callInsights.callId, callId)),
    });
    return row ?? null;
  } catch {
    return null;
  }
}

/** Insights for a set of calls, keyed by callId (one query for a list page). */
export async function insightsByCall(
  clientId: string,
  callIds: string[],
): Promise<Record<string, CallInsight>> {
  if (callIds.length === 0) return {};
  try {
    const rows = await db.query.callInsights.findMany({
      where: and(eq(callInsights.clientId, clientId), inArray(callInsights.callId, callIds)),
    });
    return Object.fromEntries(rows.map((r) => [r.callId, r]));
  } catch {
    return {};
  }
}
