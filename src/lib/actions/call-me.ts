"use server";

import { audit } from "@/lib/data/audit";
import { requireClientEditor } from "@/lib/auth-guard";
import { assertClientInOrg, getClientByIdUnsafe } from "@/lib/data/clients";
import { getRetellClient } from "@/lib/retell";
import { integrations } from "@/lib/env";
import { toE164, formatPhone } from "@/lib/format";
import { consumeAttempt, formatRetryAfter } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { DEFAULT_AGENT_NAME } from "@/lib/prompt";
import { type ActionState } from "./types";

/** Three rings per business per ten minutes. Enough to try two voices and a
 *  reworded greeting; not enough to turn the button into a prank-call tool. */
const CALLS_PER_WINDOW = 3;
const WINDOW_MS = 10 * 60_000;

/**
 * "Call me now": the receptionist rings the owner's own phone.
 *
 * The browser test call proves the AI can talk. This proves the *phone line*
 * works — the real number, the real carrier, the real voice through a real
 * handset — which is the thing an owner actually wonders about before they
 * forward their business line. It's also the demo that sells: hand someone
 * your phone, press this, and their pocket rings.
 *
 * It's the same outbound path the lead call-back uses, minus the plan gate
 * (calling yourself is a test, not a feature) and minus the calling-hours
 * window (the person being rung is the one pressing the button).
 */
export async function callMeNowAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const rawPhone = String(formData.get("phone") ?? "").trim();

  const guard = await requireClientEditor(clientId);
  if (!guard.ok) return { ok: false, error: guard.error };
  await assertClientInOrg(guard.user.orgId, clientId);

  if (!integrations.retell()) {
    return { ok: false, error: "Calling isn't connected yet." };
  }

  const to = toE164(rawPhone);
  if (!to) {
    return {
      ok: false,
      fieldErrors: {
        phone: ["Enter a full phone number with the area code, like (415) 555-0100."],
      },
    };
  }

  const client = await getClientByIdUnsafe(clientId);
  if (!client) return { ok: false, error: "Business not found." };
  if (!client.retellAgentId) {
    return { ok: false, error: "Build your receptionist first — there's nothing to ring you yet." };
  }

  const from = toE164(client.retellPhoneNumber ?? "");
  if (!from) {
    return {
      ok: false,
      error:
        "Your AI doesn't have a phone number yet, so it can't place calls. Until it does, use the browser test call.",
    };
  }
  if (from === to) {
    return { ok: false, error: "That's your AI's own number — it can't call itself." };
  }

  const limit = consumeAttempt(`call-me:${clientId}`, CALLS_PER_WINDOW, WINDOW_MS);
  if (!limit.ok) {
    return {
      ok: false,
      error: `That's a few test calls in a row — try again in ${formatRetryAfter(limit.retryAfterSec)}.`,
    };
  }

  const agentName = client.agentName?.trim() || DEFAULT_AGENT_NAME;
  // The prompt is written for answering. Without this the AI would open a
  // call it just PLACED with "thanks for calling" — so the first line says
  // what's actually happening, and invites the owner to play the customer.
  const beginMessage =
    `Hi, it's ${agentName} from ${client.name}. You asked me to give you a call so you could hear how I sound. ` +
    `Go ahead and try me — ask me anything a customer might.`;

  try {
    const call = await getRetellClient().call.createPhoneCall({
      from_number: from,
      to_number: to,
      agent_override: { retell_llm: { begin_message: beginMessage, start_speaker: "agent" } },
      metadata: { clientId, direction: "outbound", kind: "owner_test", placedBy: guard.user.id },
    });
    logger.info("call-me.placed", { clientId, callId: call.call_id });
    void audit({
      clientId,
      actor: guard.user.id,
      action: "call.owner_test_placed",
      detail: { to, retellCallId: call.call_id },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("call-me.failed", { clientId, error: message });
    return {
      ok: false,
      error: "Couldn't place the call. Your AI's number may not be able to dial out yet.",
    };
  }

  return {
    ok: true,
    message: `Calling ${formatPhone(to)} — your phone should ring in a few seconds.`,
  };
}
