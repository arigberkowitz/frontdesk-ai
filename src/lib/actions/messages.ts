"use server";

import { revalidatePath } from "next/cache";
import { resolvePortalClient } from "@/lib/auth-guard";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import { isOptedOut } from "@/lib/data/sms-optouts";
import { hasSmsConsent } from "@/lib/data/sms-consents";
import {
  countOutboundSince,
  getConversationSummary,
  markThreadRead,
} from "@/lib/data/sms-messages";
import { explainSmsError, notifier } from "@/lib/notifier";
import { integrations } from "@/lib/env";
import { logger } from "@/lib/logger";
import { stripPhoneNumbers } from "@/lib/appointment-messages";
import { parseThreadParam } from "@/lib/sms-inbox-view";
import {
  composeReply,
  PORTAL_REPLIES_PER_CLIENT_PER_DAY,
  PORTAL_REPLIES_PER_THREAD_PER_DAY,
  PORTAL_REPLY_KIND,
  validateReply,
} from "@/lib/sms-reply";
import { type ActionState } from "./types";

const DAY_MS = 24 * 3600 * 1000;

/**
 * Text a reply to a customer from portal → Messages.
 *
 * Guards, in order:
 * - The business is the one on the signed-in session (`resolvePortalClient`),
 *   never one from the form. An operator *previewing* a portal can read but not
 *   send — texting a customer in a business's name is the business's call.
 * - The customer number must already have a conversation with THIS business in
 *   `sms_messages`, so nobody can use this to text an arbitrary number.
 * - Empty input is rejected; over MAX_REPLY_CHARS is rejected.
 * - Opted out (STOP) → blocked (isOptedOut fails safe).
 * - If the customer has never texted this business, a stored consent covering
 *   "portal_reply" is required (same rule as an owner's lead follow-up).
 * - Durable daily caps per customer and per business.
 *
 * The send goes through `notifier.sendSms` with a `log` context, which records
 * the outbound row (sent/failed, provider sid, error) — that row is also what
 * keeps shared-number reply routing pointed at this business.
 */
export async function sendMessageReplyAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const phone = parseThreadParam(String(formData.get("phone") ?? ""));
  if (!phone) return { ok: false, error: "Conversation not found." };

  const { clientId, preview } = await resolvePortalClient();
  if (preview) {
    return {
      ok: false,
      error: "You're previewing this business's portal — only the business can send replies.",
    };
  }

  const input = validateReply(formData.get("body"));
  if (!input.ok) return { ok: false, error: input.error };

  let customerTexted: boolean;
  try {
    const summary = await getConversationSummary(clientId, phone);
    if (summary.total === 0) return { ok: false, error: "Conversation not found." };
    customerTexted = summary.inbound > 0;
  } catch (err) {
    logger.error("messages.reply.lookup_failed", {
      clientId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: "Couldn't load this conversation — please try again." };
  }

  if (await isOptedOut(phone, clientId)) {
    return {
      ok: false,
      error:
        "This customer texted STOP, so we can't text them. They'd have to text START first — you can still call them.",
    };
  }

  if (!customerTexted && !(await hasSmsConsent(clientId, phone, "portal_reply"))) {
    return {
      ok: false,
      error:
        "This customer hasn't texted you or agreed to texts from you, so we can't start a text conversation. Give them a call instead.",
    };
  }

  try {
    const sent = await countOutboundSince(
      clientId,
      phone,
      PORTAL_REPLY_KIND,
      new Date(Date.now() - DAY_MS),
    );
    if (sent.thread >= PORTAL_REPLIES_PER_THREAD_PER_DAY) {
      logger.warn("messages.reply.limit_thread", { clientId });
      return {
        ok: false,
        error: `You've sent this customer ${PORTAL_REPLIES_PER_THREAD_PER_DAY} texts today — that's the daily limit. Give them a call instead.`,
      };
    }
    if (sent.client >= PORTAL_REPLIES_PER_CLIENT_PER_DAY) {
      logger.warn("messages.reply.limit_client", { clientId });
      return {
        ok: false,
        error: `Your business has sent ${PORTAL_REPLIES_PER_CLIENT_PER_DAY} replies from here today — that's the daily limit. Try again tomorrow.`,
      };
    }
  } catch (err) {
    logger.error("messages.reply.limit_lookup_failed", {
      clientId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: "Couldn't send right now — please try again." };
  }

  const client = await getClientByIdUnsafe(clientId);
  if (!client) return { ok: false, error: "Conversation not found." };

  const body = composeReply(input.text, {
    businessName: stripPhoneNumbers(client.name),
    includeOptOut: !customerTexted,
  });

  const result = await notifier.sendSms({
    to: `+${phone}`,
    body,
    log: { clientId, kind: PORTAL_REPLY_KIND },
  });

  // Demo / not configured: the notifier skips without sending or recording.
  if (result.skipped || !integrations.twilio()) {
    logger.warn("messages.reply.not_configured", { clientId });
    return { ok: false, error: "Texting isn't connected yet, so nothing was sent." };
  }

  // Replying means they've seen the thread.
  try {
    await markThreadRead(clientId, phone);
  } catch {
    // Best-effort; the send already happened.
  }
  revalidatePath(`/portal/messages/${phone}`);
  revalidatePath("/portal/messages");

  if (!result.ok) {
    logger.warn("messages.reply.failed", { clientId, error: result.error });
    return {
      ok: false,
      error: explainSmsError(result.code, "Couldn't send your reply — please try again."),
    };
  }
  return { ok: true, message: "Reply sent." };
}
