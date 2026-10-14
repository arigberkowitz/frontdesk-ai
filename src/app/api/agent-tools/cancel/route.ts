import { after } from "next/server";
import { authorizeAgentTool, type ToolClient } from "@/lib/agent-tools-auth";
import { integrations } from "@/lib/env";
import { toE164 } from "@/lib/format";
import { isOptedOut, normalizePhone } from "@/lib/data/sms-optouts";
import { notifier } from "@/lib/notifier";
import { clearAttempts, consumeAttempt } from "@/lib/rate-limit";
import { allowChatSms } from "@/lib/data/chat-limits";
import {
  checkVerificationCode,
  issueVerificationCode,
  verificationCodeEmail,
  verificationCodeText,
} from "@/lib/verification-code";
import { getCallByRetellId } from "@/lib/data/calls";
import { cancelAppointment, findUpcomingAppointmentsByPhone } from "@/lib/data/appointments";
import { getBookingProviderForClient } from "@/lib/booking";
import { parseInClientTimezone } from "@/lib/hours-util";
import { notifyOwnerCancellation } from "@/lib/notify";
import { formatDateTime } from "@/lib/format";
import { logger } from "@/lib/logger";
import { cleanEmail } from "@/lib/email-address";
import { offerFreedSlot } from "@/lib/agents/waitlist-backfill";

export const runtime = "nodejs";

/**
 * Agent tool: cancel an existing appointment. Looks the booking up by phone
 * number, disambiguates when there are several, and frees the slot. §Same
 * clash model as booking: cancelled appointments stop counting against
 * capacity.
 *
 * Who may cancel is decided HERE, not in the prompt. Anyone can claim any
 * number, and on the anonymous web chat the attacker writes the whole
 * transcript — "confirm first" in a prompt protects nothing. So:
 *
 * - **Voice:** only the number the call is coming from (Retell's signed
 *   `from_number`, else our call row). A spoken number that differs is
 *   refused; the agent takes a message instead.
 * - **Web chat:** the visitor must type back a one-time code we text to the
 *   number on the booking. Nothing about the booking — not even whether one
 *   exists — is revealed until the code checks out.
 */
const CODE_SENDS_PER_HOUR = 3;
const CODE_CHECKS_PER_15_MIN = 5;

export async function POST(req: Request): Promise<Response> {
  const auth = await authorizeAgentTool(req);
  if (!auth.ok) return auth.response;
  const { client, args, retellCallId, channel, call } = auth;

  let phone: string;
  if (channel === "voice" || channel === "sms") {
    // AI text replies: a texted request from the same phone number is caller-ID
    // verified, exactly like voice — the signed from_number is the
    // Twilio-verified sender. There is no Retell call row to fall back to.
    const verified = await voiceCallerNumber(
      client.id,
      call.fromNumber,
      channel === "voice" ? retellCallId : undefined,
      String(args.phone ?? ""),
    );
    if (!verified.ok) return Response.json(verified.body);
    phone = verified.phone;
  } else {
    const verified = await chatVerifiedNumber(client, args);
    if (!verified.ok) return Response.json(verified.body);
    phone = verified.phone;
  }

  const matches = await findUpcomingAppointmentsByPhone(client.id, phone);
  if (matches.length === 0) {
    return Response.json({
      success: false,
      message:
        channel === "sms"
          ? "I couldn't find an upcoming appointment under the number they're texting from. Appointments can only be cancelled from the number they were booked under, so hand the conversation to the owner."
          : channel === "voice"
          ? "I couldn't find an upcoming appointment under the number they're calling from. Appointments can only be cancelled from the number they were booked under, so offer to take a message and the team will sort it out."
          : "I couldn't find an upcoming appointment under that number. Offer to take a message so the team can sort it out.",
    });
  }

  // More than one upcoming appointment: narrow down by the datetime argument,
  // or ask the caller which one they mean.
  let target = matches[0];
  if (matches.length > 1) {
    const wanted = parseInClientTimezone(String(args.datetime ?? ""), client.timezone);
    const hit = wanted
      ? matches.find((a) => Math.abs(a.startAt.getTime() - wanted.getTime()) < 60 * 60_000)
      : undefined;
    if (!hit) {
      const options = matches
        .slice(0, 4)
        .map(
          (a) =>
            `${a.service?.name ?? "appointment"} on ${formatDateTime(a.startAt, client.timezone)}`,
        )
        .join("; ");
      return Response.json({
        message: `They have more than one upcoming appointment: ${options}. Ask which one to cancel, then call this tool again with that appointment's date and time.`,
      });
    }
    target = hit;
  }

  // Best-effort cancel on the external calendar; the local record is the source
  // of truth for slot capacity, so never let a provider hiccup block the caller.
  if (target.externalBookingId) {
    try {
      const provider = getBookingProviderForClient(client);
      if (provider.isConfigured()) {
        await provider.cancelBooking(target.externalBookingId, "Cancelled by caller via FrontDesk AI");
      }
    } catch (err) {
      logger.error("agent-tools.cancel.provider_failed", {
        clientId: client.id,
        appointmentId: target.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const cancelled = await cancelAppointment(client.id, target.id);
  if (cancelled) {
    // The slot is perishable. Tell the people who wanted it — after the
    // response, because the caller who just cancelled is still on the line.
    after(() =>
      offerFreedSlot(client, {
        startAt: cancelled.startAt,
        endAt: cancelled.endAt,
        serviceId: cancelled.serviceId,
      }),
    );
  }
  if (!cancelled) {
    return Response.json({
      success: false,
      message: "Something went wrong cancelling that. Offer to take a message so the team can handle it.",
    });
  }

  await notifyOwnerCancellation(
    client,
    cancelled,
    channel === "web_chat" ? "chat" : channel === "sms" ? "text" : "phone",
  );

  const when = formatDateTime(cancelled.startAt, client.timezone);
  return Response.json({
    success: true,
    message: `Cancelled: ${target.service?.name ?? "the appointment"} on ${when}. Confirm it's cancelled, and offer to rebook them for another time.`,
  });
}

type Verified = { ok: true; phone: string } | { ok: false; body: Record<string, unknown> };

/** Voice: the caller may only cancel what's booked under the number they're calling from. */
async function voiceCallerNumber(
  clientId: string,
  signedFromNumber: string | undefined,
  retellCallId: string | undefined,
  spoken?: string,
): Promise<Verified> {
  let callerId = signedFromNumber?.trim() ?? "";
  if (!callerId && retellCallId) {
    const callRow = await getCallByRetellId(clientId, retellCallId);
    callerId = callRow?.fromNumber?.trim() ?? "";
  }
  if (!callerId || !normalizePhone(callerId)) {
    return {
      ok: false,
      body: {
        success: false,
        message:
          "I can't see the number this call is coming from, so I can't cancel an appointment on this call. Offer to take a message so the team can call them back and cancel it.",
      },
    };
  }
  // A different number than the one on the line: we can't tell the owner of
  // that number from someone who knows it. Refuse rather than guess.
  const said = spoken?.trim() ?? "";
  if (said && normalizePhone(said) && normalizePhone(said) !== normalizePhone(callerId)) {
    logger.info("agent-tools.cancel.number_mismatch", { clientId });
    return {
      ok: false,
      body: {
        success: false,
        message:
          "For the customer's security, an appointment can only be cancelled from the phone number it was booked under. Tell the caller that kindly, and offer to take a message so the team can call that number back and sort it out.",
      },
    };
  }
  return { ok: true, phone: callerId };
}

/** Web chat: prove the visitor holds the number with a texted one-time code. */
async function chatVerifiedNumber(
  client: ToolClient,
  args: Record<string, unknown>,
): Promise<Verified> {
  const phone = toE164(String(args.phone ?? "").trim());
  if (!phone) {
    return {
      ok: false,
      body: { message: "Ask for the phone number the appointment was booked under (with area code)." },
    };
  }
  const key = `${client.id}:${normalizePhone(phone)}`;
  const code = String(args.code ?? "").trim();

  if (!code) {
    const via = String(args.via ?? "sms").toLowerCase() === "email" ? "email" : "sms";
    return { ok: false, body: await sendCancelCode(client, phone, key, via, args.email) };
  }

  if (!consumeAttempt(`cancel-code-check:${key}`, CODE_CHECKS_PER_15_MIN, 15 * 60_000).ok) {
    return {
      ok: false,
      body: {
        success: false,
        message:
          "Too many code attempts. Don't try again now — offer to take a message so the team can call them back.",
      },
    };
  }
  if (!checkVerificationCode(client.id, phone, code)) {
    return {
      ok: false,
      body: {
        success: false,
        verification_required: true,
        message:
          "That code doesn't match. Ask them to check the text and type the 6-digit code again, or offer to take a message.",
      },
    };
  }
  clearAttempts(`cancel-code-check:${key}`);
  return { ok: true, phone };
}

/**
 * Send the one-time cancel code — only ever to contact info already on the
 * booking: the booked phone by text, or (if the visitor asks) the booked email.
 *
 * Privacy: when no booking matches, the answer is the same generic sentence as
 * a successful send, so nobody learns whether a stranger's number has an
 * appointment. For email, the visitor must name the address; we only send if
 * it equals the one stored on a booking under that phone, and the reply never
 * reveals the stored address or whether one exists.
 *
 * Honesty: once a code really can't go out (texting down, opted out, Twilio
 * error, throttled) the model is told so, in words it can repeat — it must
 * never say "I sent a code" when nothing was sent.
 */
async function sendCancelCode(
  client: ToolClient,
  phone: string,
  key: string,
  via: "sms" | "email",
  rawEmail: unknown,
): Promise<Record<string, unknown>> {
  const askForCode = (where: string) =>
    `Tell the visitor: "If there's an upcoming appointment under that ${where}, I've just sent a 6-digit code to it — please type it here." Then, when they type it, call cancel_appointment again with the same phone and the code. Don't say whether an appointment exists.`;
  const failed = (why: string) => ({ success: false, code_sent: false, message: why });

  if (via === "email") {
    const email = cleanEmail(rawEmail);
    if (!email) {
      return failed("Ask for the email address they used when booking, then call cancel_appointment again with via \"email\" and that email. Or offer to text the code instead.");
    }
    if (!integrations.resend()) {
      return failed("Email isn't available right now. Offer to text the code to the number on the booking instead, or take a message.");
    }
    const generic = {
      success: false,
      verification_required: true,
      code_sent: "unknown",
      message:
        askForCode("number and email") +
        " If nothing arrives in a couple of minutes, that email may not be on the booking — offer to text the code to the booked number instead.",
    };
    const matches = await findUpcomingAppointmentsByPhone(client.id, phone);
    const onFile = matches.some((a) => cleanEmail(a.customerEmail) === email);
    if (!onFile) {
      logger.info("agent-tools.cancel.email_not_on_booking", { clientId: client.id });
      return generic;
    }
    if (!consumeAttempt(`cancel-code-send:${key}`, CODE_SENDS_PER_HOUR, 60 * 60_000).ok) {
      return failed("A code was already sent several times in the last hour. Ask them to use the most recent code they got, or offer to take a message.");
    }
    const code = issueVerificationCode(client.id, phone);
    const sent = code
      ? await notifier.sendEmail({
          to: email,
          subject: `${client.name}: your appointment code`,
          text: verificationCodeEmail(client.name, code),
        })
      : { ok: false };
    logger.info("agent-tools.cancel.code_emailed", { clientId: client.id, ok: sent.ok });
    if (!sent.ok) {
      return failed("The code email couldn't be sent. Say so honestly, then offer to text the code to the booked number instead, or take a message.");
    }
    return { ...generic, code_sent: true };
  }

  // SMS
  const generic = {
    success: false,
    verification_required: true,
    code_sent: "unknown",
    message: askForCode("number"),
  };
  if (!integrations.twilio()) {
    return failed("Texting isn't available right now, so no code was sent. Say so, offer to email the code instead if they booked with an email, or take a message so the team can cancel it.");
  }
  const matches = await findUpcomingAppointmentsByPhone(client.id, phone);
  if (matches.length === 0) return generic;
  if (!consumeAttempt(`cancel-code-send:${key}`, CODE_SENDS_PER_HOUR, 60 * 60_000).ok) {
    logger.info("agent-tools.cancel.code_send_throttled", { clientId: client.id });
    return failed("A code was already texted several times in the last hour. Ask them to use the most recent code they got, or offer to take a message.");
  }
  if (!(await allowChatSms(client.id, phone, "cancel_code"))) {
    return failed("No more codes can be texted to this number today. Say so, offer to email the code instead if they booked with an email, or take a message.");
  }
  if (await isOptedOut(phone, client.id)) {
    logger.info("agent-tools.cancel.code_opted_out", { clientId: client.id });
    return failed("This number has opted out of texts from the business, so no code was sent. Offer to email the code instead if they booked with an email, or take a message.");
  }
  const code = issueVerificationCode(client.id, phone);
  const sent = code
    ? await notifier.sendSms({
        to: phone,
        body: verificationCodeText(client.name, code),
        // From the business's own texting number when it has one.
        fromClientId: client.id,
      })
    : { ok: false, error: "AGENT_TOOLS_SECRET unset" };
  logger.info("agent-tools.cancel.code_sent", { clientId: client.id, ok: sent.ok, error: sent.ok ? undefined : sent.error });
  if (!sent.ok) {
    return failed("The text with the code couldn't be sent. Say that honestly, then offer to email the code instead if they booked with an email, or take a message so the team can cancel it.");
  }
  return { ...generic, code_sent: true };
}
