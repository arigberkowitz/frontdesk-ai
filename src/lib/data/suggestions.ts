import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { agentSuggestions, type AgentSuggestion } from "@/db/schema";

/** Agent-suggestion data access. Callers verify client→org ownership first. */

export async function listOpenSuggestions(clientId: string): Promise<AgentSuggestion[]> {
  return db.query.agentSuggestions.findMany({
    where: and(eq(agentSuggestions.clientId, clientId), eq(agentSuggestions.status, "proposed")),
    orderBy: [desc(agentSuggestions.createdAt)],
  });
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
