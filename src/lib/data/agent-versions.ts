import "server-only";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { agentVersions, type NewAgentVersion } from "@/db/schema";

export async function listAgentVersions(clientId: string) {
  return db.query.agentVersions.findMany({
    where: eq(agentVersions.clientId, clientId),
    orderBy: [desc(agentVersions.version)],
    with: { publisher: true },
  });
}

export async function latestAgentVersion(clientId: string) {
  return db.query.agentVersions.findFirst({
    where: eq(agentVersions.clientId, clientId),
    orderBy: [desc(agentVersions.version)],
  });
}

/** Next sequential version number for a client (starts at 1). */
export async function nextVersionNumber(clientId: string): Promise<number> {
  const latest = await latestAgentVersion(clientId);
  return (latest?.version ?? 0) + 1;
}

export async function createAgentVersion(
  clientId: string,
  input: Omit<NewAgentVersion, "clientId" | "id" | "version"> & { version?: number },
) {
  const version = input.version ?? (await nextVersionNumber(clientId));
  const [row] = await db
    .insert(agentVersions)
    .values({ ...input, clientId, version })
    .returning();
  if (!row) throw new Error("Failed to snapshot agent version");
  return row;
}
