import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { appointments, callInsights, calls, leads, notifications, type Client } from "@/db/schema";
import { getAlertRecipients } from "@/lib/data/alert-contacts";
import { getCallerContext } from "@/lib/data/callers";
import { callerKey } from "@/lib/callers";
import { notifier } from "@/lib/notifier";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import {
  CALL_RECAP_KIND,
  buildRecap,
  recapSmsAllowed,
  type RecapFacts,
  type RecapKind,
} from "@/lib/call-recap";

/**
 * Send one call recap (see `call-recap.ts`) to the alert recipients.
 *
 * - **Who:** `getAlertRecipients` — the on-duty alert roster / on-the-clock
 *   staff, else the owner email + alert phone. Same routing as every alert.
 * - **Email always; SMS only where the existing settings already text that
 *   kind of alert** (`recapSmsAllowed`): SMS alerts on, and a message, a
 *   failed transfer, or an emergency. A transfer that connected never texts.
 * - **Once per call:** an advisory lock on the call plus a check for an
 *   existing `call_recap` notification makes Retell retries / replays a no-op.
 *   A send that failed outright doesn't count, so a retry can try again.
 * - Recorded in `notifications` (type `lead` for messages, else `system`;
 *   payload.kind `call_recap`). No new table, no migration.
 *
 * Runs after `extractCallInsights` so the suggested reply is ready. Never
 * throws — an alert failure must not fail the webhook.
 */

export type CallRecapResult =
  | { status: "sent"; email: number; sms: number; failed: number }
  | { status: "duplicate" }
  | { status: "no_recipient" }
  | { status: "not_found" }
  | { status: "error" };

async function loadFacts(
  client: Client,
  callId: string,
  kind: RecapKind,
  problems: string[],
): Promise<{ facts: RecapFacts; leadId: string | null } | null> {
  const [call] = await db
    .select({
      id: calls.id,
      fromNumber: calls.fromNumber,
      startAt: calls.startAt,
      summary: calls.summary,
    })
    .from(calls)
    .where(and(eq(calls.id, callId), eq(calls.clientId, client.id)))
    .limit(1);
  if (!call) return null;

  const [[lead], [insight]] = await Promise.all([
    db
      .select({
        id: leads.id,
        name: leads.name,
        phone: leads.phone,
        reason: leads.reason,
        message: leads.message,
        service: leads.service,
        urgency: leads.urgency,
      })
      .from(leads)
      .where(and(eq(leads.callId, call.id), eq(leads.clientId, client.id), isNull(leads.deletedAt)))
      .orderBy(desc(leads.createdAt))
      .limit(1),
    db
      .select({ entities: callInsights.entities, followUpDraft: callInsights.followUpDraft })
      .from(callInsights)
      .where(eq(callInsights.callId, call.id))
      .limit(1),
  ]);

  const phone = lead?.phone || call.fromNumber;
  const ctx = await getCallerContext(client.id, call.fromNumber, call.startAt);
  const visits = await appointmentHistory(client.id, phone);

  const e = (insight?.entities ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const facts: RecapFacts = {
    kind,
    business: client.name,
    timezone: client.timezone,
    call,
    lead: lead ?? null,
    insights: insight
      ? {
          name: str(e.name),
          service: str(e.service),
          requestedDate: str(e.requestedDate),
          followUpDraft: insight.followUpDraft,
        }
      : null,
    caller: { knownName: ctx.name, priorCalls: ctx.priorCalls, ...visits },
    health: { problems },
    link: `${env.APP_URL.replace(/\/$/, "")}/portal/calls/${call.id}`,
  };
  return { facts, leadId: lead?.id ?? null };
}

/** Past (non-cancelled) appointments for this number, and the next upcoming one. */
async function appointmentHistory(
  clientId: string,
  phone: string | null,
): Promise<{ pastAppointments: number; nextAppointment: Date | null }> {
  const key = callerKey(phone);
  if (!key) return { pastAppointments: 0, nextAppointment: null };
  const samePhone = sql`right(regexp_replace(coalesce(${appointments.customerPhone}, ''), '\\D', '', 'g'), 10) = ${key}`;
  const now = new Date();
  const [[past], [next]] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(appointments)
      .where(
        and(
          eq(appointments.clientId, clientId),
          isNull(appointments.deletedAt),
          ne(appointments.status, "cancelled"),
          lt(appointments.startAt, now),
          samePhone,
        ),
      ),
    db
      .select({ startAt: appointments.startAt })
      .from(appointments)
      .where(
        and(
          eq(appointments.clientId, clientId),
          isNull(appointments.deletedAt),
          inArray(appointments.status, ["booked", "confirmed"]),
          gte(appointments.startAt, now),
          samePhone,
        ),
      )
      .orderBy(asc(appointments.startAt))
      .limit(1),
  ]);
  return { pastAppointments: past?.n ?? 0, nextAppointment: next?.startAt ?? null };
}

type Target = { channel: "email" | "sms"; recipient: string };

/** Claim the call's recap: one queued notification per target, or null if already sent. */
async function claimRecap(
  clientId: string,
  callId: string,
  type: "lead" | "system",
  targets: Target[],
  payload: Record<string, unknown>,
): Promise<{ id: string; channel: "email" | "sms"; recipient: string }[] | null> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`call-recap:${callId}`}))`);
    const existing = await tx
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.clientId, clientId),
          sql`${notifications.payload}->>'kind' = ${CALL_RECAP_KIND}`,
          sql`${notifications.payload}->>'callId' = ${callId}`,
          ne(notifications.status, "failed"),
        ),
      )
      .limit(1);
    if (existing.length > 0) return null;
    return tx
      .insert(notifications)
      .values(
        targets.map((t) => ({
          clientId,
          type,
          channel: t.channel,
          recipient: t.recipient,
          payload,
          status: "queued" as const,
        })),
      )
      .returning({
        id: notifications.id,
        channel: notifications.channel,
        recipient: notifications.recipient,
      });
  });
}

export async function sendCallRecap(
  client: Client,
  callId: string,
  input: { kind: RecapKind; problems: string[] },
): Promise<CallRecapResult> {
  try {
    const loaded = await loadFacts(client, callId, input.kind, input.problems);
    if (!loaded) return { status: "not_found" };
    const recap = buildRecap(loaded.facts);

    const { emails, phones } = await getAlertRecipients(client);
    const smsTargets = recapSmsAllowed(input.kind, recap.urgent, Boolean(client.smsAlertsEnabled))
      ? phones
      : [];
    const targets: Target[] = [
      ...emails.map((recipient) => ({ channel: "email" as const, recipient })),
      ...smsTargets.map((recipient) => ({ channel: "sms" as const, recipient })),
    ];
    if (!targets.length) {
      logger.info("notify.call_recap.no_recipient", { clientId: client.id, callId });
      return { status: "no_recipient" };
    }

    const claimed = await claimRecap(
      client.id,
      callId,
      input.kind === "message" ? "lead" : "system",
      targets,
      {
        kind: CALL_RECAP_KIND,
        callId,
        recapKind: input.kind,
        urgent: recap.urgent,
        subject: recap.subject,
        ...(loaded.leadId ? { leadId: loaded.leadId } : {}),
      },
    );
    if (!claimed) return { status: "duplicate" };

    let email = 0;
    let sms = 0;
    let failed = 0;
    for (const row of claimed) {
      const r =
        row.channel === "email"
          ? await notifier.sendEmail({ to: row.recipient, subject: recap.subject, html: recap.html, text: recap.text })
          : await notifier.sendSms({ to: row.recipient, body: recap.sms });
      // Skipped (channel not configured) stays "queued", like every owner alert.
      const status = r.skipped ? "queued" : r.ok ? "sent" : "failed";
      if (r.ok) {
        if (row.channel === "email") email++;
        else sms++;
      } else if (!r.skipped) failed++;
      await db
        .update(notifications)
        .set({ status, sentAt: r.ok ? new Date() : null })
        .where(eq(notifications.id, row.id));
    }
    logger.info("notify.call_recap", { clientId: client.id, callId, kind: input.kind, email, sms, failed });
    return { status: "sent", email, sms, failed };
  } catch (err) {
    logger.error("notify.call_recap.failed", {
      clientId: client.id,
      callId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { status: "error" };
  }
}
