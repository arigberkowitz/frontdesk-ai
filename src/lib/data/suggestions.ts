import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { agentSuggestions, type AgentSuggestion } from "@/db/schema";

/** Agent-suggestion data access. Callers verify client→org ownership first. */

export async function listOpenSuggestions(clientId: string): Promise<AgentSuggestion[]> {
  // Fail-soft: renders on the portal overview — a lagging agent-layer
  // migration should hide the panel, not crash the page.
  try {
    return await db.query.agentSuggestions.findMany({
      where: and(eq(agentSuggestions.clientId, clientId), eq(agentSuggestions.status, "proposed")),
      orderBy: [desc(agentSuggestions.createdAt)],
    });
  } catch {
    return [];
  }
}

/**
 * Open suggestions the nightly loop drew from THIS call. Evidence is
 * `{ callIds: string[] }`; filtered in memory because it's jsonb and the open
 * list is short by construction.
 */
export async function listSuggestionsForCall(
  clientId: string,
  callId: string,
): Promise<AgentSuggestion[]> {
  const open = await listOpenSuggestions(clientId);
  return open.filter((s) => {
    const ev = s.evidence as { callIds?: unknown } | null;
    return Array.isArray(ev?.callIds) && ev.callIds.includes(callId);
  });
}

/** Recently reviewed (applied or dismissed) suggestions — the learning archive. */
export async function listReviewedSuggestions(
  clientId: string,
  limit = 20,
): Promise<AgentSuggestion[]> {
  try {
    return await db.query.agentSuggestions.findMany({
      where: and(
        eq(agentSuggestions.clientId, clientId),
        inArray(agentSuggestions.status, ["applied", "dismissed"]),
      ),
      orderBy: [desc(agentSuggestions.reviewedAt), desc(agentSuggestions.createdAt)],
      limit,
    });
  } catch {
    return [];
  }
}

export async function getSuggestion(
  clientId: string,
  suggestionId: string,
): Promise<AgentSuggestion | null> {
  const row = await db.query.agentSuggestions.findFirst({
    where: and(eq(agentSuggestions.id, suggestionId), eq(agentSuggestions.clientId, clientId)),
  });
  return row ?? null;
}

export async function markSuggestion(
  clientId: string,
  suggestionId: string,
  status: "applied" | "dismissed",
  reviewedBy?: string,
): Promise<void> {
  await db
    .update(agentSuggestions)
    .set({
      status,
      reviewedBy: reviewedBy ?? null,
      reviewedAt: new Date(),
      appliedAt: status === "applied" ? new Date() : null,
    })
    .where(and(eq(agentSuggestions.id, suggestionId), eq(agentSuggestions.clientId, clientId)));
}
