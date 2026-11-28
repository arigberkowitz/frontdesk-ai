import "server-only";
import { and, count, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  alertContacts,
  appointments,
  auditLog,
  callCallbacks,
  calls,
  clients,
  clientTollfree,
  knowledgeItems,
  leads,
  pushSubscriptions,
  reminders,
  smsMessages,
  smsQueue,
  subscriptions,
  users,
  waitlistEntries,
  webhookEvents,
} from "@/db/schema";
import { FREE_EMAIL_DOMAINS } from "@/lib/auth-guard";
import type { ControlClient, ControlStore, RemainingRows, ScheduledWork } from "./controls";
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
        .select({
          phoneNumber: clientTollfree.phoneNumber,
          phoneNumberSid: clientTollfree.phoneNumberSid,
          verificationSid: clientTollfree.verificationSid,
        })
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
    async cancelScheduledWork(clientId) {
      const now = new Date();
      const texts = await db
        .update(smsQueue)
        .set({ status: "dropped", result: "Company deleted by operator", updatedAt: now })
        .where(and(eq(smsQueue.clientId, clientId), eq(smsQueue.status, "queued")))
        .returning({ id: smsQueue.id });
      const rem = await db
        .update(reminders)
        .set({ status: "failed", error: "Company deleted by operator", updatedAt: now })
        .where(and(eq(reminders.clientId, clientId), eq(reminders.status, "queued")))
        .returning({ id: reminders.id });
      const cb = await db
        .update(callCallbacks)
        .set({ status: "skipped", skipReason: "Company deleted by operator", updatedAt: now })
        .where(and(eq(callCallbacks.clientId, clientId), eq(callCallbacks.status, "pending")))
        .returning({ id: callCallbacks.id });
      const wl = await db
        .update(waitlistEntries)
        .set({ status: "cancelled", updatedAt: now })
        .where(and(eq(waitlistEntries.clientId, clientId), eq(waitlistEntries.status, "waiting")))
        .returning({ id: waitlistEntries.id });
      const push = await db.delete(pushSubscriptions).where(eq(pushSubscriptions.clientId, clientId)).returning({ id: pushSubscriptions.id });
      const w: ScheduledWork = {
        queuedTexts: texts.length,
        queuedReminders: rem.length,
        pendingCallbacks: cb.length,
        waitingWaitlist: wl.length,
        pushSubscriptions: push.length,
      };
      return w;
    },
    async pendingWork(clientId) {
      const n = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
      return {
        queuedTexts: await n(db.select({ n: count() }).from(smsQueue).where(and(eq(smsQueue.clientId, clientId), eq(smsQueue.status, "queued")))),
        queuedReminders: await n(db.select({ n: count() }).from(reminders).where(and(eq(reminders.clientId, clientId), eq(reminders.status, "queued")))),
        pendingCallbacks: await n(db.select({ n: count() }).from(callCallbacks).where(and(eq(callCallbacks.clientId, clientId), eq(callCallbacks.status, "pending")))),
        waitingWaitlist: await n(db.select({ n: count() }).from(waitlistEntries).where(and(eq(waitlistEntries.clientId, clientId), eq(waitlistEntries.status, "waiting")))),
        pushSubscriptions: await n(db.select({ n: count() }).from(pushSubscriptions).where(eq(pushSubscriptions.clientId, clientId))),
      };
    },
    async listRetellCallIds(clientId) {
      const rows = await db.select({ id: calls.retellCallId }).from(calls).where(eq(calls.clientId, clientId)).limit(5000);
      return rows.map((r) => r.id).filter((x): x is string => Boolean(x));
    },
    async purgeBusiness(clientId, ids) {
      await db.transaction(async (tx) => {
        // The audit trail that names this business goes; the operator's fraud flags are the one thing kept.
        await tx.delete(auditLog).where(and(eq(auditLog.clientId, clientId), ne(auditLog.action, TRIAL_BLOCK_ACTION)));
        // Its portal users. Never an operator (the platform owner / agency staff).
        await tx.delete(users).where(and(eq(users.clientId, clientId), ne(users.role, "operator")));
        // Stored vendor payloads that carry its ids (transcripts, addresses). The rows stay for webhook dedupe.
        const needles = [clientId, ids.agentId].filter((x): x is string => Boolean(x));
        for (const needle of needles) {
          await tx.update(webhookEvents).set({ payload: null }).where(sql`${webhookEvents.payload}::text like ${"%" + needle + "%"}`);
        }
        // Everything else cascades from the client row (calls, leads, messages, knowledge, appointments, ...).
        await tx.delete(clients).where(eq(clients.id, clientId));
      });
      return this.remainingRows(clientId);
    },
    async remainingRows(clientId): Promise<RemainingRows> {
      const n = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
      return {
        client: await n(db.select({ n: count() }).from(clients).where(eq(clients.id, clientId))),
        calls: await n(db.select({ n: count() }).from(calls).where(eq(calls.clientId, clientId))),
        leads: await n(db.select({ n: count() }).from(leads).where(eq(leads.clientId, clientId))),
        messages: await n(db.select({ n: count() }).from(smsMessages).where(eq(smsMessages.clientId, clientId))),
        knowledge: await n(db.select({ n: count() }).from(knowledgeItems).where(eq(knowledgeItems.clientId, clientId))),
        appointments: await n(db.select({ n: count() }).from(appointments).where(eq(appointments.clientId, clientId))),
        users: await n(db.select({ n: count() }).from(users).where(and(eq(users.clientId, clientId), ne(users.role, "operator")))),
        subscriptions: await n(db.select({ n: count() }).from(subscriptions).where(eq(subscriptions.clientId, clientId))),
        other: await n(db.select({ n: count() }).from(auditLog).where(and(eq(auditLog.clientId, clientId), ne(auditLog.action, TRIAL_BLOCK_ACTION)))),
      };
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
