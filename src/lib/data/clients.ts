import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { clients, type Client, type ClientStatus, type NewClient } from "@/db/schema";

/**
 * Client data access. Every function is scoped by `orgId` so an operator can
 * only ever touch their own agency's clients (§12 tenant isolation).
 */

export async function listClients(orgId: string): Promise<Client[]> {
  return db.query.clients.findMany({
    where: and(eq(clients.orgId, orgId), isNull(clients.deletedAt)),
    orderBy: [desc(clients.createdAt)],
  });
}

export async function getClient(orgId: string, clientId: string) {
  return db.query.clients.findFirst({
    where: and(eq(clients.id, clientId), eq(clients.orgId, orgId), isNull(clients.deletedAt)),
    with: {
      services: {
        where: (s, { isNull: n }) => n(s.deletedAt),
        orderBy: (s, { asc }) => [asc(s.name)],
      },
      businessHours: { orderBy: (h, { asc }) => [asc(h.dayOfWeek)] },
      knowledgeItems: {
        where: (k, { isNull: n }) => n(k.deletedAt),
        orderBy: (k, { desc: d }) => [d(k.createdAt)],
      },
    },
  });
}

export type ClientWithRelations = NonNullable<Awaited<ReturnType<typeof getClient>>>;

/** Look up a client by its Retell agent id (webhook context — not org-scoped). */
export async function getClientByRetellAgentId(agentId: string) {
  return db.query.clients.findFirst({
    where: and(eq(clients.retellAgentId, agentId), isNull(clients.deletedAt)),
    with: {
      businessHours: { orderBy: (h, { asc }) => [asc(h.dayOfWeek)] },
      services: { where: (s, { isNull: n }) => n(s.deletedAt) },
    },
  });
}

/**
 * Fetch a client by id WITHOUT org scoping — only for machine endpoints already
 * authenticated by a shared secret (agent-tool callbacks). Includes services +
 * hours needed to resolve bookings.
 */
export async function getClientByIdUnsafe(clientId: string) {
  return db.query.clients.findFirst({
    where: and(eq(clients.id, clientId), isNull(clients.deletedAt)),
    with: {
      businessHours: { orderBy: (h, { asc }) => [asc(h.dayOfWeek)] },
      services: { where: (s, { isNull: n }) => n(s.deletedAt) },
    },
  });
}

/** Throw unless the client exists and belongs to the org. Returns the row. */
export async function assertClientInOrg(orgId: string, clientId: string): Promise<Client> {
  const row = await db.query.clients.findFirst({
    where: and(eq(clients.id, clientId), eq(clients.orgId, orgId), isNull(clients.deletedAt)),
  });
  if (!row) throw new Error("Client not found");
  return row;
}

export async function createClient(
  orgId: string,
  input: Pick<NewClient, "name" | "websiteUrl" | "industry" | "address" | "timezone">,
): Promise<Client> {
  const [row] = await db.insert(clients).values({ ...input, orgId }).returning();
  if (!row) throw new Error("Failed to create client");
  return row;
}

export async function updateClient(
  orgId: string,
  clientId: string,
  patch: Partial<NewClient>,
): Promise<Client> {
  const [row] = await db
    .update(clients)
    .set(patch)
    .where(and(eq(clients.id, clientId), eq(clients.orgId, orgId), isNull(clients.deletedAt)))
    .returning();
  if (!row) throw new Error("Client not found");
  return row;
}

export async function setClientStatus(
  orgId: string,
  clientId: string,
  status: ClientStatus,
): Promise<Client> {
  return updateClient(orgId, clientId, { status });
}

export async function softDeleteClient(orgId: string, clientId: string): Promise<void> {
  await db
    .update(clients)
    .set({ deletedAt: new Date() })
    .where(and(eq(clients.id, clientId), eq(clients.orgId, orgId)));
}
