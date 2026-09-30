import "server-only";
import { and, count, desc, eq, inArray, isNull, max, sql } from "drizzle-orm";
import { db } from "@/db";
import { smsMessages, type SmsMessageRow } from "@/db/schema";
import { normalizePhone } from "@/lib/data/sms-optouts";
import { logger } from "@/lib/logger";

/**
 * The SMS inbox: every text between a business and its customers.
 *
 * Tenant isolation (§12): every READ here takes the caller's `clientId` and
 * filters on it — there is no function that returns another business's rows
 * given a customer phone alone. Pages must pass the clientId from
 * `resolvePortalClient()`, never one from the URL.
 *
 * Writes are best-effort. Storing a message is a record for the owner; it must
 * never break STOP handling in the webhook or a send in the notifier, so the
 * write helpers log and swallow their own failures (e.g. migration lag).
 */

export type InboundKind = "reply" | "opt_out" | "opt_in" | "help";

/** Customer key used for threads: normalized digits ("14155550100"). */
export function customerKeyFor(raw: string | null | undefined): string | null {
  const key = normalizePhone(raw ?? "");
  return key.length >= 10 ? key : null;
}

/**
 * Store one inbound message. Returns `isNew: false` when this Twilio
 * MessageSid was already stored — a webhook replay — so the caller can skip
 * side effects (like emailing the owner) it already did the first time.
 * Returns `stored: false` if the write failed; the caller carries on.
 */
export async function recordInboundSms(input: {
  clientId: string;
  from: string;
  to: string | null;
  body: string;
  providerSid: string | null;
  kind: InboundKind;
  leadId?: string | null;
}): Promise<{ stored: boolean; isNew: boolean }> {
  const customerPhone = customerKeyFor(input.from);
  if (!customerPhone) return { stored: false, isNew: true };
  try {
    const inserted = await db
      .insert(smsMessages)
      .values({
        clientId: input.clientId,
        direction: "inbound",
        customerPhone,
        businessPhone: input.to ? normalizePhone(input.to) : null,
        body: input.body,
        status: "received",
        kind: input.kind,
        providerSid: input.providerSid || null,
        leadId: input.leadId ?? null,
      })
      .onConflictDoNothing({ target: smsMessages.providerSid })
      .returning({ id: smsMessages.id });
    return { stored: true, isNew: inserted.length > 0 };
  } catch (err) {
    logger.error("sms.inbox.inbound_store_failed", {
      clientId: input.clientId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { stored: false, isNew: true };
  }
}

export interface OutboundLogContext {
  clientId: string;
  /** What sent it — the reminder kind, or e.g. "lead_followup". */
  kind: string;
  appointmentId?: string | null;
  leadId?: string | null;
}

/** Store one outbound customer text. Never throws. */
export async function recordOutboundSms(
  ctx: OutboundLogContext,
  msg: {
    to: string;
    from: string | null;
    body: string;
    ok: boolean;
    providerSid?: string | null;
    error?: string | null;
  },
): Promise<void> {
  const customerPhone = customerKeyFor(msg.to);
  if (!customerPhone) return;
  try {
    await db
      .insert(smsMessages)
      .values({
        clientId: ctx.clientId,
        direction: "outbound",
        customerPhone,
        businessPhone: msg.from ? normalizePhone(msg.from) : null,
        body: msg.body,
        status: msg.ok ? "sent" : "failed",
        kind: ctx.kind,
        providerSid: msg.providerSid || null,
        appointmentId: ctx.appointmentId ?? null,
        leadId: ctx.leadId ?? null,
        error: msg.ok ? null : (msg.error ?? "Send failed"),
      })
      .onConflictDoNothing({ target: smsMessages.providerSid });
  } catch (err) {
    logger.error("sms.inbox.outbound_store_failed", {
      clientId: ctx.clientId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Carrier verdict from Twilio's status callback. Never throws. */
export async function updateSmsDeliveryStatus(
  providerSid: string,
  status: "delivered" | "failed",
  error?: string | null,
): Promise<void> {
  if (!providerSid) return;
  try {
    await db
      .update(smsMessages)
      .set(status === "failed" ? { status, error: error ?? null } : { status })
      .where(and(eq(smsMessages.providerSid, providerSid), eq(smsMessages.direction, "outbound")));
  } catch (err) {
    logger.warn("sms.inbox.status_update_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Which business most recently texted this customer, per the inbox log.
 * Used to attribute a reply that arrived on the shared sending number.
 * Returns null on any error (e.g. table not migrated yet) so the caller can
 * fall back to the older reminders-based lookup.
 */
export async function findClientLastMessaged(phone: string): Promise<string | null> {
  const customerPhone = customerKeyFor(phone);
  if (!customerPhone) return null;
  try {
    const [row] = await db
      .select({ clientId: smsMessages.clientId })
      .from(smsMessages)
      .where(and(eq(smsMessages.customerPhone, customerPhone), eq(smsMessages.direction, "outbound")))
      .orderBy(desc(smsMessages.createdAt))
      .limit(1);
    return row?.clientId ?? null;
  } catch {
    return null;
  }
}

/* --------------------------------- reads --------------------------------- */

export interface Conversation {
  customerPhone: string;
  lastBody: string;
  lastDirection: "inbound" | "outbound";
  lastAt: Date;
  unread: number;
  total: number;
}

/** One row per customer this business has texted with, most recent first. */
export async function listConversations(clientId: string, limit = 200): Promise<Conversation[]> {
  const unreadExpr = sql<number>`count(*) filter (where ${smsMessages.direction} = 'inbound' and ${smsMessages.readAt} is null)`;
  const groups = await db
    .select({
      customerPhone: smsMessages.customerPhone,
      lastAt: max(smsMessages.createdAt),
      total: count(),
      unread: unreadExpr.mapWith(Number),
    })
    .from(smsMessages)
    .where(eq(smsMessages.clientId, clientId))
    .groupBy(smsMessages.customerPhone)
    .orderBy(desc(max(smsMessages.createdAt)))
    .limit(limit);
  if (groups.length === 0) return [];

  const latest = await db
    .selectDistinctOn([smsMessages.customerPhone], {
      customerPhone: smsMessages.customerPhone,
      body: smsMessages.body,
      direction: smsMessages.direction,
    })
    .from(smsMessages)
    .where(
      and(
        eq(smsMessages.clientId, clientId),
        inArray(
          smsMessages.customerPhone,
          groups.map((g) => g.customerPhone),
        ),
      ),
    )
    .orderBy(smsMessages.customerPhone, desc(smsMessages.createdAt), desc(smsMessages.id));
  const byPhone = new Map(latest.map((l) => [l.customerPhone, l]));

  return groups.map((g) => {
    const last = byPhone.get(g.customerPhone);
    return {
      customerPhone: g.customerPhone,
      lastBody: last?.body ?? "",
      lastDirection: last?.direction ?? "outbound",
      lastAt: g.lastAt ? new Date(g.lastAt) : new Date(0),
      unread: Number(g.unread) || 0,
      total: Number(g.total) || 0,
    };
  });
}

/** Every message with one customer, oldest first — scoped to this business. */
export async function getThread(
  clientId: string,
  customerPhone: string,
  limit = 500,
): Promise<SmsMessageRow[]> {
  const key = customerKeyFor(customerPhone);
  if (!key) return [];
  const rows = await db
    .select()
    .from(smsMessages)
    .where(and(eq(smsMessages.clientId, clientId), eq(smsMessages.customerPhone, key)))
    .orderBy(desc(smsMessages.createdAt), desc(smsMessages.id))
    .limit(limit);
  return rows.reverse();
}

/** Mark this business's unread inbound messages from one customer as read. */
export async function markThreadRead(clientId: string, customerPhone: string): Promise<number> {
  const key = customerKeyFor(customerPhone);
  if (!key) return 0;
  const updated = await db
    .update(smsMessages)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(smsMessages.clientId, clientId),
        eq(smsMessages.customerPhone, key),
        eq(smsMessages.direction, "inbound"),
        isNull(smsMessages.readAt),
      ),
    )
    .returning({ id: smsMessages.id });
  return updated.length;
}

/**
 * Unread inbound messages for the nav badge. Rendered on every portal page, so
 * it must never throw — 0 if the table isn't there yet.
 */
export async function countUnreadMessages(clientId: string): Promise<number> {
  try {
    const [row] = await db
      .select({ n: count() })
      .from(smsMessages)
      .where(
        and(
          eq(smsMessages.clientId, clientId),
          eq(smsMessages.direction, "inbound"),
          isNull(smsMessages.readAt),
        ),
      );
    return Number(row?.n ?? 0);
  } catch {
    return 0;
  }
}
