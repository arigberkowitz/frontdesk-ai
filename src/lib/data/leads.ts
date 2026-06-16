import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { leads, type Lead, type NewLead } from "@/db/schema";

export async function listLeads(clientId: string) {
  return db.query.leads.findMany({
    where: and(eq(leads.clientId, clientId), isNull(leads.deletedAt)),
    orderBy: [desc(leads.createdAt)],
  });
}

/** A single lead scoped to its client (portal-safe). */
export async function getClientLead(clientId: string, leadId: string) {
  return db.query.leads.findFirst({
    where: and(eq(leads.id, leadId), eq(leads.clientId, clientId), isNull(leads.deletedAt)),
  });
}

/** Update a lead's follow-up status (scoped to its client). */
export async function updateLeadStatus(
  clientId: string,
  leadId: string,
  status: Lead["status"],
): Promise<void> {
  await db
    .update(leads)
    .set({ status })
    .where(and(eq(leads.id, leadId), eq(leads.clientId, clientId), isNull(leads.deletedAt)));
}

export async function createLead(clientId: string, input: Omit<NewLead, "clientId" | "id">) {
  const [row] = await db.insert(leads).values({ ...input, clientId }).returning();
  if (!row) throw new Error("Failed to create lead");
  return row;
}
