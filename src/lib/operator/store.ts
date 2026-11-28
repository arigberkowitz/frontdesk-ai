import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { alertContacts, auditLog, clients, clientTollfree, smsQueue, subscriptions, users } from "@/db/schema";
import { FREE_EMAIL_DOMAINS } from "@/lib/auth-guard";
import type { ControlClient, ControlStore } from "./controls";
import type { ActiveHoldings, OrphanStore } from "./orphans";
import { matchesBlock, TRIAL_BLOCK_ACTION, type BlockedIdentity } from "./trial-block";

/** Postgres-backed `ControlStore` + `OrphanStore`. Nothing here talks to a vendor. */
export function liveStore(): ControlStore & OrphanStore {
  return {
    async getClient(clientId) {
      const row = await db.query.clients.findFirst({ where: eq(clients.id, clientId) });
      return (row as ControlClient | undefined) ?? null;
    },
    async patchClient(clientId, patch) {
      await db.update(clients).set(patch).where(eq(clients.id, clientId));
    },
    async mergeFlags(clientId, set, remove = []) {
      // One atomic jsonb expression, so a flag written meanwhile (a minute-cap
      // mark, a blocked number) isn't lost to a read-modify-write.
      let expr = sql`coalesce(${clients.setupFlags}, '{}'::jsonb)`;
      for (const key of remove) expr = sql`(${expr}) - ${key}::text`;
      if (Object.keys(set).length > 0) expr = sql`(${expr}) || ${JSON.stringify(set)}::jsonb`;
      await db.update(clients).set({ setupFlags: expr }).where(eq(clients.id, clientId));
    },
    async getSubscription(clientId) {
      const [row] = await db
        .select({
          stripeSubscriptionId: subscriptions.stripeSubscriptionId,
          stripeCustomerId: subscriptions.stripeCustomerId,
          status: subscriptions.status,
        })
        .from(subscriptions)
        .where(eq(subscriptions.clientId, clientId))
        .limit(1);
      return row ?? null;
    },
    async markSubscriptionStatus(clientId, status) {
      await db.update(subscriptions).set({ status }).where(eq(subscriptions.clientId, clientId));
    },
    async getTollfree(clientId) {
      const [row] = await db
        .select({ phoneNumber: clientTollfree.phoneNumber, phoneNumberSid: clientTollfree.phoneNumberSid })
        .from(clientTollfree)
        .where(eq(clientTollfree.clientId, clientId))
        .limit(1);
      return row ?? null;
    },
    async clearTollfree(clientId) {
      await db
        .update(clientTollfree)
        .set({ phoneNumber: null, phoneNumberSid: null, status: "needs_number", updatedAt: new Date() })
        .where(eq(clientTollfree.clientId, clientId));
    },
    async dropQueuedTexts(clientId) {
      const rows = await db
        .update(smsQueue)
        .set({ status: "dropped", result: "Company suspended by operator", updatedAt: new Date() })
        .where(and(eq(smsQueue.clientId, clientId), eq(smsQueue.status, "queued")))
        .returning({ id: smsQueue.id });
      return rows.length;
    },
    async identitiesFor(clientId) {
      // The business's own people only: never an operator (that's the platform owner).
      const members = await db
        .select({ email: users.email })
        .from(users)
        .where(and(eq(users.clientId, clientId), isNull(users.deletedAt), sql`${users.role} <> 'operator'`));
      const [c] = await db
        .select({ ownerEmail: clients.ownerEmail, escalation: clients.escalationNumber })
        .from(clients)
        .where(eq(clients.id, clientId))
        .limit(1);
      const contacts = await db
        .select({ email: alertContacts.email, phone: alertContacts.phone })
        .from(alertContacts)
        .where(eq(alertContacts.clientId, clientId));
      return {
        emails: [c?.ownerEmail, ...members.map((m) => m.email), ...contacts.map((a) => a.email)].filter((e): e is string => Boolean(e)),
        phones: [c?.escalation, ...contacts.map((a) => a.phone)].filter((p): p is string => Boolean(p)),
      };
    },
    isFreeEmailDomain: (d) => FREE_EMAIL_DOMAINS.has(d),
    async writeTrialBlock(clientId, identity, detail) {
      await db.insert(auditLog).values({
        clientId,
        actor: "operator",
        action: TRIAL_BLOCK_ACTION,
        detail: { ...detail, ...identity },
      });
    },
    async audit(entry) {
      // Best effort by design (see lib/data/audit.ts): a receipt that can't be
      // written must not turn a finished delete into a reported failure.
      try {
        await db.insert(auditLog).values({
          clientId: entry.clientId,
          actor: entry.actor,
          action: entry.action,
          detail: entry.detail,
        });
      } catch {
        // swallowed on purpose
      }
    },
    async activeHoldings(): Promise<ActiveHoldings> {
      const rows = await db
        .select({
          id: clients.id,
          agentId: clients.retellAgentId,
          llmId: clients.retellLlmId,
          phone: clients.retellPhoneNumber,
          sms: clients.smsNumber,
          tfSid: clientTollfree.phoneNumberSid,
          tfPhone: clientTollfree.phoneNumber,
          subId: subscriptions.stripeSubscriptionId,
        })
        .from(clients)
        .leftJoin(clientTollfree, eq(clientTollfree.clientId, clients.id))
        .leftJoin(subscriptions, eq(subscriptions.clientId, clients.id))
        .where(isNull(clients.deletedAt));
      const h: ActiveHoldings = {
        agentIds: new Set(),
        llmIds: new Set(),
        phoneDigits: new Set(),
        tollfreeSids: new Set(),
        smsNumbers: new Set(),
        stripeSubscriptionIds: new Set(),
        clientsAwaitingSubscription: new Set(),
      };
      for (const r of rows) {
        if (r.agentId) h.agentIds.add(r.agentId);
        if (r.llmId) h.llmIds.add(r.llmId);
        if (r.phone) h.phoneDigits.add(r.phone.replace(/\D/g, "").slice(-10));
        if (r.tfSid) h.tollfreeSids.add(r.tfSid);
        if (r.tfPhone) h.smsNumbers.add(r.tfPhone);
        if (r.sms) h.smsNumbers.add(r.sms);
        if (r.subId) h.stripeSubscriptionIds.add(r.subId);
        else h.clientsAwaitingSubscription.add(r.id);
      }
      return h;
    },
  };
}

/** Has an operator flagged any of these identities as fraud? Fails open (never blocks on an error). */
export async function isTrialBlocked(who: {
  emails: (string | null | undefined)[];
  phones: (string | null | undefined)[];
}): Promise<boolean> {
  try {
    const rows = await db.select({ detail: auditLog.detail }).from(auditLog).where(eq(auditLog.action, TRIAL_BLOCK_ACTION));
    const blocks = rows.map((r) => r.detail as unknown as BlockedIdentity).filter(Boolean);
    return matchesBlock(blocks, who, (d) => FREE_EMAIL_DOMAINS.has(d));
  } catch {
    return false;
  }
}
