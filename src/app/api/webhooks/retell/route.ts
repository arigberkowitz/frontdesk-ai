import { after } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appointments, leads, type CallOutcome, type NewCall } from "@/db/schema";
import { extractCallInsights } from "@/lib/agents/extract";
import { verifyRetellSignature } from "@/lib/retell";
import { getClientByRetellAgentId } from "@/lib/data/clients";
import { upsertCallByRetellId } from "@/lib/data/calls";
import { analyzeCall } from "@/lib/call-health";
import { isBlocked, normalizeForBlock } from "@/lib/spam";
import { recordTurnedAway, screenInboundCall } from "@/lib/data/inbound-screen";
import { notifyOwnerCallProblem } from "@/lib/notify";
import { recapKindFor, transferStatus, type RecapKind } from "@/lib/call-recap";
import { sendCallRecap } from "@/lib/call-recap-send";
import {
  deleteWebhookEvent,
  markWebhookProcessed,
  recordWebhookEvent,
} from "@/lib/data/webhook-events";
import { isAfterHours } from "@/lib/hours-util";
import { logger } from "@/lib/logger";
import { emitWebhook } from "@/lib/webhooks-emit";

// node:crypto (signature verify) — force the Node runtime.
export const runtime = "nodejs";

interface RetellCall {
  call_id?: string;
  agent_id?: string;
  from_number?: string;
  to_number?: string;
  start_timestamp?: number;
  end_timestamp?: number;
  duration_ms?: number;
  recording_url?: string;
  transcript?: string;
  call_analysis?: {
    call_summary?: string;
    user_sentiment?: string;
    custom_analysis_data?: Record<string, unknown>;
  };
  call_cost?: { combined_cost?: number };
  metadata?: { direction?: string };
  /** Why the call ended, e.g. "user_hangup", "agent_hangup", "call_transfer", "transfer_cancelled", "voicemail_reached", error_*, inactivity. Kept in raw_payload. */
  disconnection_reason?: string;
}
interface RetellWebhook {
  event?: string;
  call?: RetellCall;
  /** Only on "call_inbound": sent while the phone is still ringing, before any agent starts. */
  call_inbound?: { call_id?: string; agent_id?: string; from_number?: string; to_number?: string };
}

/** Retell waits up to 10s for the inbound answer; we answer well before that, or let the call through. */
export const INBOUND_SCREEN_TIMEOUT_MS = 3_000;

/**
 * "call_inbound": decide, while the line is still ringing, whether the AI
 * should pick up at all. Owner-blocked numbers and repeat spam (spam.ts) get
 * `reject: true`, so Retell hangs up before any agent or voice starts — no
 * minutes, no vendor cost, nothing for the owner to wade through.
 *
 * Fail-open on purpose: an error, a slow database or an unknown number answers
 * `{}` and the call goes to the business's agent as it always has. Missing a
 * robocall costs a minute; dropping a customer costs the customer. Not
 * ledgered: there is no call yet, and Retell retries reuse the same call_id,
 * so recomputing the same answer is the idempotent thing.
 */
async function handleInbound(payload: RetellWebhook): Promise<Response> {
  const info = payload.call_inbound ?? {};
  const accept = Response.json({ call_inbound: {} });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), INBOUND_SCREEN_TIMEOUT_MS);
    });
    const result = await Promise.race([
      screenInboundCall({
        agentId: info.agent_id,
        toNumber: info.to_number,
        fromNumber: info.from_number,
      }),
      timeout,
    ]);
    if (!result) {
      logger.warn("webhook.retell.inbound_screen_timeout", { callId: info.call_id });
      return accept;
    }
    if (result.screen.reject) {
      logger.info("webhook.retell.inbound_rejected", {
        clientId: result.clientId,
        callId: info.call_id,
        reason: result.screen.reason,
        phone: normalizeForBlock(info.from_number),
      });
      // Rejected calls leave no row in the call log, so note it where the
      // owner can see it — after answering, so a slow write never delays the
      // hang-up, and a failed one never turns into answering the call.
      const phone = normalizeForBlock(info.from_number);
      const { clientId } = result;
      const reason = result.screen.reason;
      if (clientId && phone) {
        const logFailed = (err: unknown) =>
          logger.warn("webhook.retell.turned_away_log_failed", {
            clientId,
            callId: info.call_id,
            error: err instanceof Error ? err.message : String(err),
          });
        try {
          after(() =>
            recordTurnedAway(clientId, { phone, reason, callId: info.call_id }).catch(logFailed),
          );
        } catch (err) {
          // Never let the bookkeeping turn a reject into an answer.
          logFailed(err);
        }
      }
      // Only `reject`: Retell validates any other field, and a bad one would void the reject.
      return Response.json({ call_inbound: { reject: true } });
    }
    return accept;
  } catch (err) {
    logger.warn("webhook.retell.inbound_screen_failed", {
      callId: info.call_id,
      error: err instanceof Error ? err.message : String(err),
    });
    return accept;
  } finally {
    clearTimeout(timer);
  }
}

function mapSentiment(s?: string): NewCall["sentiment"] {
  if (!s) return null;
  const v = s.toLowerCase();
  if (v.includes("positive")) return "positive";
  if (v.includes("negative")) return "negative";
  if (v.includes("neutral")) return "neutral";
  return "unknown";
}

async function classifyOutcome(
  callId: string,
  custom: Record<string, unknown>,
): Promise<CallOutcome> {
  const appt = await db.query.appointments.findFirst({ where: eq(appointments.callId, callId) });
  if (appt) return "booked";
  const lead = await db.query.leads.findFirst({ where: eq(leads.callId, callId) });
  if (lead) return "lead";
  if (custom.booked === true) return "booked";
  return "faq_answered";
}

export async function POST(req: Request): Promise<Response> {
  const raw = await req.text();
  const signature = req.headers.get("x-retell-signature");
  if (!verifyRetellSignature(raw, signature)) {
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: RetellWebhook;
  try {
    payload = JSON.parse(raw) as RetellWebhook;
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  const event = payload.event ?? "unknown";
  if (event === "call_inbound") return handleInbound(payload);
  const call = payload.call ?? {};
  const callId = call.call_id;
  if (!callId) return Response.json({ ok: true, ignored: "no call_id" });

  // §C5 idempotency: one ledger row per (call, event); replays short-circuit.
  const externalId = `${callId}:${event}`;
  const { isNew } = await recordWebhookEvent({
    source: "retell",
    externalId,
    eventType: event,
    payload,
  });
  if (!isNew) return Response.json({ ok: true, deduped: true });

  const client = call.agent_id ? await getClientByRetellAgentId(call.agent_id) : null;
  if (!client) {
    await markWebhookProcessed("retell", externalId, "ignored");
    logger.warn("webhook.retell.no_client", { agentId: call.agent_id, event });
    return Response.json({ ok: true, ignored: "unknown agent" });
  }

  if (event !== "call_started" && event !== "call_ended" && event !== "call_analyzed") {
    await markWebhookProcessed("retell", externalId, "ignored");
    return Response.json({ ok: true, ignored: event });
  }

  try {
    const startAt = call.start_timestamp ? new Date(call.start_timestamp) : new Date();
    const analysis = call.call_analysis ?? {};
    const custom = analysis.custom_analysis_data ?? {};

    const values: NewCall & { retellCallId: string } = {
      clientId: client.id,
      retellCallId: callId,
      // We stamp direction into metadata when WE place the call. Hardcoding
      // "inbound" here filed every AI callback as a call the customer made —
      // wrong in the call log, and wrong in every metric built on it.
      direction: call.metadata?.direction === "outbound" ? "outbound" : "inbound",
      fromNumber: call.from_number ?? null,
      toNumber: call.to_number ?? null,
      startAt,
      endAt: call.end_timestamp ? new Date(call.end_timestamp) : null,
      durationSec: call.duration_ms ? Math.round(call.duration_ms / 1000) : null,
      recordingUrl: call.recording_url ?? null,
      transcript: call.transcript ?? null,
      summary: analysis.call_summary ?? null,
      sentiment: mapSentiment(analysis.user_sentiment),
      retellCostCents:
        call.call_cost?.combined_cost != null ? Math.round(call.call_cost.combined_cost) : null,
      isAfterHours: isAfterHours(startAt, client.timezone, client.businessHours),
      rawPayload: payload,
    };

    // A number the owner blocked is normally turned away before the AI answers
    // (handleInbound). If one gets through anyway — the screen fails open — it
    // still costs nobody attention: no lead, no alert, no place in the numbers
    // we ask this business to trust.
    const blockedNumbers = client.setupFlags?.blockedNumbers ?? [];
    const callerBlocked = isBlocked(values.fromNumber, blockedNumbers);
    if (callerBlocked) values.outcome = "spam";

    const row = await upsertCallByRetellId(values);

    if (callerBlocked) {
      logger.info("webhook.retell.blocked_caller", {
        clientId: client.id,
        callId,
        phone: normalizeForBlock(values.fromNumber),
      });
      await markWebhookProcessed("retell", externalId, "processed");
      return Response.json({ ok: true, blocked: true });
    }

    // A free trial's first test call is what unlocks its own phone number
    // (number-gate.ts). Hand it over now rather than waiting for the owner to
    // find "Get my phone number": the gate, the daily cap and the
    // first-provision lock all still decide, so a replay buys nothing extra.
    if (event === "call_ended" && client.status === "trial" && !client.retellPhoneNumber) {
      const clientId = client.id;
      after(() =>
        import("@/lib/provision")
          .then(({ provisionNumberIfUnlocked }) => provisionNumberIfUnlocked(clientId))
          .catch((err) =>
            logger.warn("webhook.retell.trial_number_failed", {
              clientId,
              error: err instanceof Error ? err.message : String(err),
            }),
          ),
      );
    }

    // Classify only on terminal events (appointments/leads now exist).
    let recap: { kind: RecapKind; problems: string[] } | null = null;
    if ((event === "call_ended" || event === "call_analyzed") && row) {
      const outcome = await classifyOutcome(row.id, custom);
      await upsertCallByRetellId({ ...values, outcome });

      // Did the AI hand this call to a person, and did it get through?
      const transfer = transferStatus({
        transcript: values.transcript,
        disconnectionReason: call.disconnection_reason,
        durationSec: values.durationSec,
      });
      const health = analyzeCall({
        transcript: values.transcript,
        durationSec: values.durationSec,
        outcome,
        // A transfer that reached a person is not a stranded caller. This used
        // to be `outcome === "escalated"`, which nothing sets, so every caller
        // who asked for a person and GOT one was alerted as stranded.
        transferConnected: transfer.attempted && !transfer.failed,
      });

      // A message taken or a transfer → one recap after the call (below), which
      // carries the urgency and transfer findings. Everything else keeps the
      // call-problem alert: a caller who asked for a person and never got one,
      // and anything that sounded like an emergency. Both still have a window
      // where a callback fixes them.
      // The message tool defers its alert to this recap, so a message taken on
      // a call that ALSO booked must still be recapped, not dropped.
      const hasLead =
        outcome === "lead" ||
        (outcome === "booked" &&
          Boolean(await db.query.leads.findFirst({ where: eq(leads.callId, row.id) })));
      const kind = recapKindFor({
        direction: values.direction,
        outcome,
        hasLead,
        transfer,
      });
      if (kind) recap = { kind, problems: health.problems };
      if (
        !kind &&
        health.problems.some((p) => p === "possible_emergency" || p === "stranded_asking_for_human")
      ) {
        after(() =>
          notifyOwnerCallProblem(
            client,
            { id: row.id, fromNumber: values.fromNumber ?? null, startAt: values.startAt ?? null },
            health,
          ).catch((err) =>
            logger.error("webhook.retell.problem_alert_failed", {
              callId: row.id,
              error: err instanceof Error ? err.message : String(err),
            }),
          ),
        );
      }
    }

    // Agent #2 — post-call extraction (intent, entities, spam, follow-up draft),
    // then the call recap, which reuses the extraction's suggested reply.
    // Runs after the response is sent so Retell never waits on the model.
    //
    // Missed/dropped-call text-back chains after them, because it reads the
    // extracted intent/spam flag. Only loaded when the business turned it on
    // (off by default), so a business without it pays nothing. It skips calls
    // that were transferred or where a message was taken (those get the recap).
    if (event === "call_analyzed" && row) {
      const callDbId = row.id;
      const hasTranscript = Boolean(values.transcript);
      const pending = recap;
      const textBack = client.missedCallTextsEnabled;
      if (hasTranscript || pending || textBack) {
        after(async () => {
          if (hasTranscript) {
            await extractCallInsights(callDbId).catch((err) =>
              logger.error("webhook.retell.extract_failed", {
                callId: callDbId,
                error: err instanceof Error ? err.message : String(err),
              }),
            );
          }
          if (pending) await sendCallRecap(client, callDbId, pending);
          if (textBack) {
            const { considerMissedCall } = await import("@/lib/agents/missed-call-callback");
            const result = await considerMissedCall(callDbId);
            logger.info("webhook.retell.missed_call", {
              clientId: client.id,
              callId: callDbId,
              result,
            });
          }
        });
      }
    }

    // `call_analyzed`, not `call_ended`: this is the event that carries the
    // transcript and summary, and a CRM row with neither is a row somebody has
    // to come back to. Retell is waiting on this response, so it goes after.
    if (event === "call_analyzed" && row) {
      const callDbId = row.id;
      after(() =>
        emitWebhook(client.id, "call.completed", {
          callId: callDbId,
          retellCallId: callId,
          fromNumber: values.fromNumber ?? null,
          toNumber: values.toNumber ?? null,
          startAt: values.startAt?.toISOString() ?? null,
          durationSec: values.durationSec ?? null,
          direction: values.direction ?? null,
          outcome: values.outcome ?? null,
          sentiment: values.sentiment ?? null,
          summary: values.summary ?? null,
          transcript: values.transcript ?? null,
          recordingUrl: values.recordingUrl ?? null,
        }),
      );
    }

    await markWebhookProcessed("retell", externalId, "processed");
    return Response.json({ ok: true });
  } catch (err) {
    logger.error("webhook.retell.failed", {
      event,
      callId,
      error: err instanceof Error ? err.message : String(err),
    });
    // Drop the ledger row so Retell's retry reprocesses instead of short-circuiting
    // as a duplicate — otherwise a transient failure silently loses the call.
    await deleteWebhookEvent("retell", externalId);
    return new Response("Processing error", { status: 500 });
  }
}
