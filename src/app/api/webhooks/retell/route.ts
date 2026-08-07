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
import { notifyOwnerCallProblem } from "@/lib/notify";
import {
  deleteWebhookEvent,
  markWebhookProcessed,
  recordWebhookEvent,
} from "@/lib/data/webhook-events";
import { isAfterHours } from "@/lib/hours-util";
import { logger } from "@/lib/logger";

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
}
interface RetellWebhook {
  event?: string;
  call?: RetellCall;
}

function mapSentiment(s?: string): NewCall["sentiment"] {
  if (!s) return null;
  const v = s.toLowerCase();
  if (v.includes("positive")) return "positive";
  if (v.includes("negative")) return "negative";
  if (v.includes("neutral")) return "neutral";
  return "unknown";
}

async function classifyOutcome(callId: string, custom: Record<string, unknown>): Promise<CallOutcome> {
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

    // A number the owner blocked is noise from here on. It still rings the
    // line — we don't control the carrier — but it stops costing anyone
    // attention: no lead, no alert, no place in the numbers we ask this
    // business to trust. Counting robocalls and then doing nothing about them
    // is the vendor behaviour that ends contracts.
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

    // Classify only on terminal events (appointments/leads now exist).
    if ((event === "call_ended" || event === "call_analyzed") && row) {
      const outcome = await classifyOutcome(row.id, custom);
      await upsertCallByRetellId({ ...values, outcome });

      // Two failures are worth waking someone for: a caller who asked for a
      // person and never got one, and anything that sounded like an emergency.
      // Both still have a window where a callback fixes them; by the time
      // either shows up on a dashboard, it usually doesn't.
      const health = analyzeCall({
        transcript: values.transcript,
        durationSec: values.durationSec,
        outcome,
        transferConnected: outcome === "escalated",
      });
      if (health.problems.some((p) => p === "possible_emergency" || p === "stranded_asking_for_human")) {
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

    // Agent #2 — post-call extraction (intent, entities, spam, follow-up draft).
    // Runs after the response is sent so Retell never waits on the model.
    if (event === "call_analyzed" && row && values.transcript) {
      const callDbId = row.id;
      after(() => extractCallInsights(callDbId));
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
