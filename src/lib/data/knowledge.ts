import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { knowledgeItems, type KnowledgeItem, type NewKnowledgeItem } from "@/db/schema";

/** FAQ / knowledge data access. Callers verify client→org ownership first. */

export async function listKnowledge(clientId: string): Promise<KnowledgeItem[]> {
  return db.query.knowledgeItems.findMany({
    where: and(eq(knowledgeItems.clientId, clientId), isNull(knowledgeItems.deletedAt)),
    orderBy: [desc(knowledgeItems.createdAt)],
  });
}

export async function createKnowledge(
  clientId: string,
  input: Omit<NewKnowledgeItem, "clientId" | "id">,
): Promise<KnowledgeItem> {
  const [row] = await db.insert(knowledgeItems).values({ ...input, clientId }).returning();
  if (!row) throw new Error("Failed to create knowledge item");
  return row;
}

export async function updateKnowledge(
  clientId: string,
  itemId: string,
  patch: Partial<NewKnowledgeItem>,
): Promise<KnowledgeItem> {
  const [row] = await db
    .update(knowledgeItems)
    .set(patch)
    .where(and(eq(knowledgeItems.id, itemId), eq(knowledgeItems.clientId, clientId)))
    .returning();
  if (!row) throw new Error("Knowledge item not found");
  return row;
}

export async function deleteKnowledge(clientId: string, itemId: string): Promise<void> {
  await db
    .update(knowledgeItems)
    .set({ deletedAt: new Date(), isActive: false })
    .where(and(eq(knowledgeItems.id, itemId), eq(knowledgeItems.clientId, clientId)));
}
