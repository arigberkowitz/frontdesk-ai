import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { services, type NewService, type Service } from "@/db/schema";

/** Service data access. Callers must verify client→org ownership first. */

export async function listServices(clientId: string): Promise<Service[]> {
  return db.query.services.findMany({
    where: and(eq(services.clientId, clientId), isNull(services.deletedAt)),
    orderBy: [asc(services.name)],
  });
}

export async function createService(
  clientId: string,
  input: Omit<NewService, "clientId" | "id">,
): Promise<Service> {
  const [row] = await db.insert(services).values({ ...input, clientId }).returning();
  if (!row) throw new Error("Failed to create service");
  return row;
}

export async function updateService(
  clientId: string,
  serviceId: string,
  patch: Partial<NewService>,
): Promise<Service> {
  const [row] = await db
    .update(services)
    .set(patch)
    .where(and(eq(services.id, serviceId), eq(services.clientId, clientId)))
    .returning();
  if (!row) throw new Error("Service not found");
  return row;
}

export async function deleteService(clientId: string, serviceId: string): Promise<void> {
  await db
    .update(services)
    .set({ deletedAt: new Date(), isActive: false })
    .where(and(eq(services.id, serviceId), eq(services.clientId, clientId)));
}
