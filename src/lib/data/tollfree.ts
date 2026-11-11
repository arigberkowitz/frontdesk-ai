import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
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
  /**
   * Atomically claim the right to buy this business's toll-free number. True
   * only if ALL hold right now: setup is finished (clients.setup_completed_at),
   * an active or trialing subscription exists, the business has no texting
   * number (clients.sms_number) and no bought toll-free number, and no other
   * buy is in flight. See TOLLFREE_BUY_LOCK_MINUTES.
   */
  claimBuy(clientId: string): Promise<boolean>;
  /** Drop the in-flight buy lock (after the number is saved, or the buy failed). */
  releaseBuy(clientId: string): Promise<void>;
}

/** How long a toll-free buy lock holds before it's treated as abandoned. */
export const TOLLFREE_BUY_LOCK_MINUTES = 15;

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
  async claimBuy(clientId) {
    // One UPDATE: every condition and the lock are checked and taken together,
    // so two webhooks racing on the same business can't both pass. A second
    // UPDATE on the same row waits for the first, then re-checks the lock.
    const rows = await db
      .update(clients)
      .set({
        setupFlags: sql`coalesce(${clients.setupFlags}, '{}'::jsonb) || jsonb_build_object('tollfreeBuyingAt', ${new Date().toISOString()}::text)`,
      })
      .where(
        and(
          eq(clients.id, clientId),
          isNull(clients.deletedAt),
          sql`${clients.setupCompletedAt} is not null`,
          isNull(clients.smsNumber),
          sql`exists (select 1 from subscriptions s where s.client_id = ${clients.id} and s.status in ('active', 'trialing') and s.deleted_at is null)`,
          sql`not exists (select 1 from client_tollfree t where t.client_id = ${clients.id} and t.phone_number_sid is not null)`,
          sql`(${clients.setupFlags}->>'tollfreeBuyingAt' is null or (${clients.setupFlags}->>'tollfreeBuyingAt')::timestamptz < now() - make_interval(mins => ${TOLLFREE_BUY_LOCK_MINUTES}))`,
        ),
      )
      .returning({ id: clients.id });
    return rows.length > 0;
  },
  async releaseBuy(clientId) {
    await db
      .update(clients)
      .set({ setupFlags: sql`${clients.setupFlags} - 'tollfreeBuyingAt'` })
      .where(eq(clients.id, clientId));
  },
};
