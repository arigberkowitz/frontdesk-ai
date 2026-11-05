import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { clientTollfree, clients, type ClientTollfree } from "@/db/schema";

/** Storage for the toll-free flow, behind an interface so the service is testable. */
export interface TollfreeStore {
  get(clientId: string): Promise<ClientTollfree | null>;
  save(clientId: string, patch: Partial<Omit<ClientTollfree, "id" | "clientId" | "createdAt">>): Promise<void>;
  byVerificationSid(sid: string): Promise<ClientTollfree | null>;
  listSubmitted(): Promise<ClientTollfree[]>;
  client(clientId: string): Promise<{ id: string; name: string; smsNumber: string | null } | null>;
  /** Point the business's texting at its approved number (only if it has none). */
  useAsSmsNumber(clientId: string, e164: string): Promise<void>;
}

export const tollfreeStore: TollfreeStore = {
  async get(clientId) {
    return (await db.query.clientTollfree.findFirst({ where: eq(clientTollfree.clientId, clientId) })) ?? null;
  },
  async save(clientId, patch) {
    await db
      .insert(clientTollfree)
      .values({ clientId, ...patch })
      .onConflictDoUpdate({ target: clientTollfree.clientId, set: { ...patch, updatedAt: new Date() } });
  },
  async byVerificationSid(sid) {
    return (await db.query.clientTollfree.findFirst({ where: eq(clientTollfree.verificationSid, sid) })) ?? null;
  },
  async listSubmitted() {
    return db.query.clientTollfree.findMany({ where: eq(clientTollfree.status, "submitted") });
  },
  async client(clientId) {
    return (
      (await db.query.clients.findFirst({
        where: and(eq(clients.id, clientId), isNull(clients.deletedAt)),
        columns: { id: true, name: true, smsNumber: true },
      })) ?? null
    );
  },
  async useAsSmsNumber(clientId, e164) {
    await db
      .update(clients)
      .set({ smsNumber: e164 })
      .where(and(eq(clients.id, clientId), isNull(clients.smsNumber), isNull(clients.deletedAt)));
  },
};
