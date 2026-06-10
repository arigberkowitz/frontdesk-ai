import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { leads, type NewLead } from "@/db/schema";

export async function listLeads(clientId: string) {
  return db.query.leads.findMany({
    where: and(eq(leads.clientId, clientId), isNull(leads.deletedAt)),
    orderBy: [desc(leads.createdAt)],
  });
}

export async function createLead(clientId: string, input: Omit<NewLead, "clientId" | "id">) {
  const [row] = await db.insert(leads).values({ ...input, clientId }).returning();
  if (!row) throw new Error("Failed to create lead");
  return row;
}
