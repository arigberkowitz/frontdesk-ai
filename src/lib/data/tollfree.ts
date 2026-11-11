import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { clientTollfree, clients, type ClientTollfree } from "@/db/schema";
import type { TollfreePurchaseFacts } from "@/lib/tollfree/eligibility";

/** Storage for the toll-free flow, behind an interface so the service is testable. */
export interface TollfreeStore {
  get(clientId: string): Promise<ClientTollfree | null>;
  save(clientId: string, patch: Partial<Omit<ClientTollfree, "id" | "clientId" | "createdAt">>): Promise<void>;
  byVerificationSid(sid: string): Promise<ClientTollfree | null>;
  listSubmitted(): Promise<ClientTollfree[]>;
  client(clientId: string): Promise<TollfreeClient | null>;
  /**
   * Claim the right to buy this business's number. Atomic, so two webhooks (or
   * a webhook and "I'm done") landing together can't both buy. False = someone
   * else holds a fresh claim.
   */
  claimPurchase(clientId: string): Promise<boolean>;
  releasePurchase(clientId: string): Promise<void>;
  /** Point the business's texting at its approved number (only if it has none). */
  useAsSmsNumber(clientId: string, e164: string): Promise<void>;
}

/** The business, plus the facts the purchase rules need (see eligibility.ts). */
export interface TollfreeClient extends TollfreePurchaseFacts {
  id: string;
  name: string;
}

/** How long a purchase claim holds before it's treated as abandoned. */
const PURCHASE_LOCK_MINUTES = 3;

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
    const c = await db.query.clients.findFirst({
      where: and(eq(clients.id, clientId), isNull(clients.deletedAt)),
      columns: { id: true, name: true, smsNumber: true, status: true, setupCompletedAt: true, setupFlags: true },
      with: { subscription: { columns: { status: true } } },
    });
    if (!c) return null;
    return {
      id: c.id,
      name: c.name,
      smsNumber: c.smsNumber,
      status: c.status,
      setupCompletedAt: c.setupCompletedAt,
      comped: Boolean(c.setupFlags?.comped),
      subscriptionStatus: c.subscription?.status ?? null,
    };
  },
  async claimPurchase(clientId) {
    const rows = await db
      .update(clients)
      .set({
        setupFlags: sql`coalesce(${clients.setupFlags}, '{}'::jsonb) || jsonb_build_object('tollfreeBuyingAt', ${new Date().toISOString()}::text)`,
      })
      .where(
        and(
          eq(clients.id, clientId),
          isNull(clients.deletedAt),
          sql`(${clients.setupFlags}->>'tollfreeBuyingAt' is null or (${clients.setupFlags}->>'tollfreeBuyingAt')::timestamptz < now() - make_interval(mins => ${PURCHASE_LOCK_MINUTES}))`,
        ),
      )
      .returning({ id: clients.id });
    return rows.length > 0;
  },
  async releasePurchase(clientId) {
    await db
      .update(clients)
      .set({ setupFlags: sql`${clients.setupFlags} - 'tollfreeBuyingAt'` })
      .where(eq(clients.id, clientId));
  },
  async useAsSmsNumber(clientId, e164) {
    await db
      .update(clients)
      .set({ smsNumber: e164 })
      .where(and(eq(clients.id, clientId), isNull(clients.smsNumber), isNull(clients.deletedAt)));
  },
};
