import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { knowledgeItems, services } from "@/db/schema";

/** Services + FAQs a business already has (what a website draft would add to). */
export async function countDraftableContent(clientId: string): Promise<number> {
  const [svc] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(services)
    .where(and(eq(services.clientId, clientId), isNull(services.deletedAt)));
  const [kb] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(knowledgeItems)
    .where(and(eq(knowledgeItems.clientId, clientId), isNull(knowledgeItems.deletedAt)));
  return (svc?.n ?? 0) + (kb?.n ?? 0);
}
