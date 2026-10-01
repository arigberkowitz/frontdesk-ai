import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appointments, callInsights, calls, clients, leads, type CallCallbackRow } from "@/db/schema";
import {
  calledAgainSince,
  claimCallback,
  duePendingCallbacks,
  expireStaleCallbacks,
  hasBookingFor,
  recordSkippedCallback,
  sentLastDay,
  updateCallback,
} from "@/lib/data/call-callbacks";
import { isOptedOut, normalizePhone } from "@/lib/data/sms-optouts";
import { hasSmsConsent } from "@/lib/data/sms-consents";
import { withinTextingHours } from "@/lib/appointment-messages";
import { isBlocked } from "@/lib/spam";
import { toE164 } from "@/lib/format";
import { env, integrations } from "@/lib/env";
import { notifier } from "@/lib/notifier";
import { logger } from "@/lib/logger";
import {
  callbackOpener,
  callbackText,
  classifyCall,
  isStale,
  MAX_CALLBACKS_PER_CLIENT_PER_DAY,
  serviceFor,
  textablePhone,
  type CallbackReason,
} from "@/lib/missed-call";

/**
 * Missed/dropped-call text-back.
 *
 * After Retell's `call_analyzed` (and Agent #2's extraction), decide whether
 * this caller left without what they came for — hung up in the first seconds,
 * the line dropped, or they walked away mid-booking — and if so send ONE
 * templated text offering to finish booking by reply. The reply lands in the
 * normal Messages inbox, where the owner (or AI text replies, if that feature
 * is on) picks it up. Nothing here is model-written and nothing the caller
 * said is copied into the text.
 *
 * Every gate is checked again at send time, because time passes between the
 * call and the send (texting hours) and the world changes (they rang back,
 * booked online, texted STOP).
 */

export const MISSED_CALL_SMS_KIND = "missed_call_text";

type Client = typeof clients.$inferSelect & { services: { name: string; isActive: boolean | null }[] };

async function loadClient(clientId: string): Promise<Client | null> {
  const c = await db.query.clients.findFirst({
    where: eq(clients.id, clientId),
    with: { services: { columns: { name: true, isActive: true } } },
  });
  return (c as Client | undefined) ?? null;
}

function eligibleBusiness(client: Pick<Client, "status" | "missedCallTextsEnabled">): boolean {
  return client.missedCallTextsEnabled && (client.status === "live" || client.status === "trial");
}

function disconnectionReason(raw: unknown): string | null {
  const call = (raw as { call?: { disconnection_reason?: unknown } } | null)?.call;
  return typeof call?.disconnection_reason === "string" ? call.disconnection_reason : null;
}

export type ConsiderResult =
  | "off"
  | "no_call"
  | "no_phone"
  | "duplicate_call"
  | "recent_callback"
  | `skipped:${string}`
  | DeliverResult;

/** Entry point from the Retell webhook. Never throws. */
export async function considerMissedCall(callDbId: string, now = new Date()): Promise<ConsiderResult> {
  try {
    const call = await db.query.calls.findFirst({ where: eq(calls.id, callDbId) });
    if (!call) return "no_call";
    const client = await loadClient(call.clientId);
    // Off by default, per business. With it off we don't even write a row.
    if (!client || !eligibleBusiness(client)) return "off";

    const to = textablePhone(toE164(call.fromNumber));
    if (!to) return "no_phone";
    const phoneKey = normalizePhone(to);

    const [insight, appt, lead] = await Promise.all([
      db.query.callInsights.findFirst({ where: eq(callInsights.callId, call.id) }),
      db.query.appointments.findFirst({ where: eq(appointments.callId, call.id), columns: { id: true } }),
      db.query.leads.findFirst({ where: eq(leads.callId, call.id), columns: { id: true } }),
    ]);

    const verdict = classifyCall({
      direction: call.direction,
      outcome: call.outcome,
      durationSec: call.durationSec,
      disconnectionReason: disconnectionReason(call.rawPayload),
      transcript: call.transcript,
      intent: insight?.intent ?? null,
      isSpam: insight?.isSpam ?? false,
      callerBlocked: isBlocked(call.fromNumber, client.setupFlags?.blockedNumbers ?? []),
      bookedOnCall: Boolean(appt),
      leadOnCall: Boolean(lead),
    });
    if (!verdict.ok) {
      // Outbound calls are ours (including our own AI callbacks) — not worth a row.
      if (verdict.skip !== "outbound_call") {
        await recordSkippedCallback({
          clientId: client.id,
          callId: call.id,
          phoneKey,
          reason: "none",
          skipReason: verdict.skip,
        });
      }
      return `skipped:${verdict.skip}`;
    }

    const claim = await claimCallback({
      clientId: client.id,
      callId: call.id,
      phoneKey,
      reason: verdict.reason,
      sendAfter: now,
    });
    if (claim.kind !== "claimed") return claim.kind;

    const entities = (insight?.entities ?? {}) as { service?: unknown };
    return await deliverCallback(claim.row, client, {
      to,
      callStartedAt: call.startAt ?? call.createdAt,
      serviceName: serviceFor(entities.service, client.services),
      now,
    });
  } catch (err) {
    logger.error("missed_call.consider_failed", {
      callId: callDbId,
      error: err instanceof Error ? err.message : String(err),
    });
    return "skipped:error";
  }
}

export type DeliverResult = "sent_sms" | "sent_call" | "deferred" | "failed" | `skipped:${string}`;

async function skip(row: CallCallbackRow, reason: string): Promise<DeliverResult> {
  await updateCallback(row.id, { status: "skipped", skipReason: reason });
  logger.info("missed_call.skipped", { clientId: row.clientId, callbackId: row.id, reason });
  return `skipped:${reason}`;
}

/** True only when every switch for an AI phone callback is on. */
export function aiCallbackAllowed(client: Pick<Client, "missedCallAiCallbacksEnabled" | "retellPhoneNumber">): boolean {
  return (
    env.MISSED_CALL_AI_CALLBACKS &&
    client.missedCallAiCallbacksEnabled &&
    integrations.retell() &&
    Boolean(toE164(client.retellPhoneNumber ?? ""))
  );
}

/** Send (or defer, or skip) one claimed callback. Re-checks every gate. */
export async function deliverCallback(
  row: CallCallbackRow,
  client: Client,
  ctx: { to: string; callStartedAt: Date; serviceName: string | null; now: Date },
): Promise<DeliverResult> {
  const { to, now } = ctx;
  if (!eligibleBusiness(client)) return skip(row, "feature_off");
  if (isStale(ctx.callStartedAt, now)) return skip(row, "too_old");
  if (await isOptedOut(to, client.id)) return skip(row, "opted_out");
  // Opt-out alone isn't permission: a stored consent covering this purpose is.
  if (!(await hasSmsConsent(client.id, to, "missed_call"))) return skip(row, "no_consent");
  if (await hasBookingFor(client.id, row.customerPhone, ctx.callStartedAt)) {
    return skip(row, "already_booked");
  }
  if (await calledAgainSince(client.id, row.customerPhone, ctx.callStartedAt, row.callId)) {
    return skip(row, "called_again");
  }
  // Outside 9am–8pm their time: leave it pending; the daily sweep sends it
  // in-window if it's still fresh, otherwise it expires.
  if (!withinTextingHours(now, client.timezone)) return "deferred";
  if ((await sentLastDay(client.id)) >= MAX_CALLBACKS_PER_CLIENT_PER_DAY) {
    return skip(row, "daily_cap");
  }

  const reason = row.reason as CallbackReason;

  if (aiCallbackAllowed(client)) {
    const placed = await placeAiCallback(client, row, to, reason);
    if (placed) {
      await updateCallback(row.id, { status: "sent", channel: "ai_call", sentAt: now, retellCallId: placed });
      return "sent_call";
    }
    // Fall through to the text — a callback that can't be placed shouldn't mean silence.
  }

  const body = callbackText({ businessName: client.name, reason, serviceName: ctx.serviceName });
  const result = await notifier.sendSms({
    to,
    body,
    log: { clientId: client.id, kind: MISSED_CALL_SMS_KIND },
  });
  if (result.skipped) return skip(row, "sms_not_configured");
  if (!result.ok) {
    await updateCallback(row.id, { status: "failed", channel: "sms", error: result.error ?? "send failed" });
    return "failed";
  }
  await updateCallback(row.id, { status: "sent", channel: "sms", sentAt: now });
  logger.info("missed_call.sent", { clientId: client.id, callbackId: row.id, reason });
  return "sent_sms";
}

/** Place the AI callback through Retell. Returns the Retell call id, or null. */
async function placeAiCallback(
  client: Client,
  row: CallCallbackRow,
  to: string,
  reason: CallbackReason,
): Promise<string | null> {
  try {
    const [{ planAccessFor }, { getRetellClient }, { withRequiredDisclosure }] = await Promise.all([
      import("@/lib/plan-access"),
      import("@/lib/retell"),
      import("@/lib/prompt"),
    ]);
    if (!(await planAccessFor(client)).has("outbound_ai_calls")) return null;
    const from = toE164(client.retellPhoneNumber ?? "");
    if (!from) return null;
    const beginMessage = withRequiredDisclosure(
      callbackOpener({ agentName: client.agentName, businessName: client.name, reason }),
      { businessName: client.name, recording: client.recordingDisclosureEnabled },
    );
    const call = await getRetellClient().call.createPhoneCall({
      from_number: from,
      to_number: to,
      agent_override: { retell_llm: { begin_message: beginMessage, start_speaker: "agent" } },
      // direction=outbound: the webhook files it as ours, and classifyCall
      // never treats it as a missed call to call back (no loops).
      metadata: { clientId: client.id, direction: "outbound", kind: "missed_call_callback", callbackId: row.id },
    });
    logger.info("missed_call.ai_call_placed", { clientId: client.id, callbackId: row.id, retellCallId: call.call_id });
    return call.call_id;
  } catch (err) {
    logger.error("missed_call.ai_call_failed", {
      clientId: client.id,
      callbackId: row.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Daily sweep: send callbacks deferred by texting hours, expire stale ones. */
export async function sweepMissedCallCallbacks(now = new Date()): Promise<{
  considered: number;
  results: Record<string, number>;
}> {
  const due = await duePendingCallbacks(now);
  const results: Record<string, number> = {};
  const clientCache = new Map<string, Client | null>();
  for (const row of due) {
    let client = clientCache.get(row.clientId);
    if (client === undefined) {
      client = await loadClient(row.clientId);
      clientCache.set(row.clientId, client);
    }
    let r: DeliverResult;
    const call = await db.query.calls.findFirst({ where: eq(calls.id, row.callId) });
    if (!client || !call) r = await skip(row, "missing");
    else {
      const insight = await db.query.callInsights.findFirst({ where: eq(callInsights.callId, call.id) });
      const entities = (insight?.entities ?? {}) as { service?: unknown };
      r = await deliverCallback(row, client, {
        to: `+${row.customerPhone}`,
        callStartedAt: call.startAt ?? call.createdAt,
        serviceName: serviceFor(entities.service, client.services),
        now,
      });
    }
    results[r] = (results[r] ?? 0) + 1;
  }
  await expireStaleCallbacks(now);
  return { considered: due.length, results };
}
