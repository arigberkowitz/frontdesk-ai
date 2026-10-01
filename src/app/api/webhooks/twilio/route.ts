import { createHmac, timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { leads } from "@/db/schema";
import { recordOptOut, removeOptOut, normalizePhone } from "@/lib/data/sms-optouts";
import { reminders, type Client } from "@/db/schema";
import { storeInboundMessage } from "@/lib/sms-inbox";
import { findClientBySmsNumber } from "@/lib/data/sms-numbers";
import { updateSmsDeliveryStatus } from "@/lib/data/sms-messages";
import { explainSmsError } from "@/lib/notifier";
import { audit } from "@/lib/data/audit";
import { notifyOwnerTextReply } from "@/lib/reply-alerts";
import { env, webhookUrl } from "@/lib/env";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * Inbound SMS webhook (configure on the Twilio number: Messaging → "A message
 * comes in" → POST to /api/webhooks/twilio).
 *
 * Two jobs, both compliance-critical for A2P:
 *  1. STOP/HELP keywords — record the opt-out so no automation ever texts the
 *     number again (Twilio also blocks at carrier level; we mirror it so our
 *     own logic can't even try). START re-subscribes.
 *  2. Replies — a human texted back. Stamp the lead's lastReplyAt (recovery
 *     stands down) and email the business's alert recipients (throttled per
 *     conversation, never by text — see src/lib/reply-alerts.ts).
 *
 * Every inbound message — replies AND the STOP/START/HELP keywords — is also
 * stored in the business's SMS inbox (sms_messages, keyed by MessageSid so a
 * replay is stored once), which is what the portal's Messages page shows.
 * Storing is best-effort and always happens AFTER the compliance action, so a
 * failure there can never cost anyone their opt-out.
 */

const STOP_WORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit"]);
const START_WORDS = new Set(["start", "yes", "unstop"]);
const HELP_WORDS = new Set(["help", "info"]);

function twiml(message?: string): Response {
  const body = message
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message}</Message></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
  return new Response(body, { headers: { "content-type": "text/xml" } });
}

/**
 * Hostnames this webhook may legitimately be addressed at.
 *
 * Twilio signs each request against the EXACT url it posts to, so verification
 * has to use that same url — not whatever APP_URL happens to be. A number
 * configured against an older hostname would otherwise 401 forever, silently,
 * and this is the handler that processes STOP. Dropping opt-outs is the worst
 * failure available to us, so accept either host and verify honestly against
 * whichever one was used.
 *
 * This is not a weakening: the HMAC still has to be valid for the url claimed,
 * and only Twilio can produce that. The allowlist exists so an attacker can't
 * nominate a host of their own via a forged Host header.
 */
const ALLOWED_WEBHOOK_HOSTS = ["frontdeskai.company", "frontdesk-ai-alpha.vercel.app"];

/** Every url this request could plausibly have been signed against. */
function candidateUrls(req: Request): string[] {
  const seen = new Set<string>([webhookUrl("/api/webhooks/twilio")]);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host && ALLOWED_WEBHOOK_HOSTS.includes(host.split(":")[0])) {
    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    seen.add(`${proto}://${host}/api/webhooks/twilio`);
  }
  return [...seen];
}

/** Twilio request signature: HMAC-SHA1(url + sorted-concatenated params, auth token). */
function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string | null,
): boolean {
  if (!env.TWILIO_AUTH_TOKEN || !signature) return false;
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((k) => k + params[k])
      .join("");
  const expected = createHmac("sha1", env.TWILIO_AUTH_TOKEN).update(data).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}


/**
 * The opt-out keyword in a message, if there is one.
 *
 * This used to strip every non-letter from the WHOLE message and compare the
 * result to a fixed list, which only ever matched a text containing exactly one
 * word. "STOP please", "stop, start again", "Stop!" — all ignored. Meanwhile
 * the carriers and Twilio's own opt-out handling are far more forgiving, so
 * they would honour a STOP that we never recorded: our list would say the
 * person is subscribed while their carrier silently drops everything we send.
 * Divergence between our opt-out list and the real one is the worst outcome
 * available here, because it looks like everything is working.
 *
 * So: match on the FIRST word. Someone who opens with "stop" means stop, no
 * matter what follows — including "stop, start again", where the first word
 * wins and they stay opted out until they send a clean START.
 */
export function optOutKeyword(body: string): string {
  const words = body.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  // "stop all" and "unsubscribe" are single tokens in our lists; two-word forms
  // like "stop all" collapse to their first word, which is the intent anyway.
  const [first, second] = words;
  if (first === "stop" && second === "all") return "stopall";
  return first;
}

/** Did they say anything beyond the keyword itself? "STOP" vs "cancel my 2pm". */
export function hasMoreThanKeyword(body: string): boolean {
  return body.trim().replace(/[^a-z\s]/gi, " ").trim().split(/\s+/).filter(Boolean).length > 1;
}

/**
 * A human texted back — get it to the business.
 *
 * Attributed to the tenant they were actually talking to. If they're a lead
 * there, stamp the lead so the recovery agent stands down and stops texting
 * someone who has already answered. Then email the alert recipients — for
 * EVERY customer text, not only leads: a reply to a reminder or a customer
 * the owner texted from Messages matters just as much. Throttled per
 * conversation, email only (see notifyOwnerTextReply).
 */
async function forwardReplyToOwner(
  owner: Client | null,
  params: Record<string, string>,
  from: string,
  body: string,
): Promise<void> {
  // The owner is resolved once, in storeInboundMessage (see resolveInboundClient
  // for the To → last-texted fallback), so the inbox and this email always
  // agree about which business a reply belongs to.
  if (!owner) {
    logger.warn("sms.reply.unknown_recipient", { to: normalizePhone(params.To ?? "") });
    return;
  }

  const digits = normalizePhone(from);
  const lead = await db.query.leads.findFirst({
    where: and(
      eq(leads.clientId, owner.id),
      sql`regexp_replace(coalesce(${leads.phone}, ''), '[^0-9]', '', 'g') like ${"%" + digits.slice(-10)}`,
      isNull(leads.deletedAt),
    ),
    orderBy: [desc(leads.createdAt)],
  });

  if (lead) {
    await db.update(leads).set({ lastReplyAt: new Date() }).where(eq(leads.id, lead.id));
    // The email below is a notification; this row is the record. If the email
    // bounces or gets deleted, what the customer actually said still exists.
    void audit({
      clientId: owner.id,
      actor: "webhook:twilio",
      action: "sms.reply_received",
      detail: { leadId: lead.id, from: digits, body: body.slice(0, 500) },
    });
  } else {
    logger.info("sms.reply.no_lead", { clientId: owner.id });
  }

  // An alert failure must never turn into a webhook failure (Twilio would
  // retry, and the retry is deduped as a replay anyway).
  try {
    await notifyOwnerTextReply(owner, {
      customerPhone: digits,
      body,
      name: lead?.name ?? null,
      followUpsPaused: Boolean(lead),
    });
  } catch (err) {
    logger.error("sms.reply.alert_failed", {
      clientId: owner.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  logger.info("sms.reply.forwarded", { clientId: owner.id, leadId: lead?.id ?? null });
}

export async function POST(req: Request): Promise<Response> {
  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) {
    if (typeof v === "string") params[k] = v;
  }

  const signature = req.headers.get("x-twilio-signature");

  // A missing auth token and a genuinely forged request both used to come out
  // as an indistinguishable 401. They are completely different problems — one
  // is a deployment mistake that silently disables STOP, the other is exactly
  // what the check is for — so say which is which, loudly.
  if (!env.TWILIO_AUTH_TOKEN) {
    logger.error("webhook.twilio.not_configured", {
      detail: "TWILIO_AUTH_TOKEN is unset, so no inbound message can ever be verified — STOP and HELP are dead until it's set.",
    });
    return new Response("Webhook not configured", { status: 503 });
  }

  const urls = candidateUrls(req);
  if (!urls.some((u) => verifyTwilioSignature(u, params, signature))) {
    // Log the host we were addressed at, not just what we expected. A mismatch
    // between the two is the failure mode that cost us an afternoon.
    logger.warn("webhook.twilio.bad_signature", {
      tried: urls,
      host: req.headers.get("x-forwarded-host") ?? req.headers.get("host"),
      hasSignature: Boolean(signature),
      params: Object.keys(params).sort(),
    });
    return new Response("Invalid signature", { status: 401 });
  }

  // Delivery status callbacks arrive at this same URL (we set statusCallback on
  // every send). They carry MessageStatus and no meaningful Body, and they are
  // the only place the CARRIER'S verdict ever reaches us: our send call only
  // hears that Twilio accepted the message. Without this branch a text bounced
  // by the carrier stays recorded as "sent" forever — the quietest lie in the
  // product, discovered when a customer says nobody ever told them anything.
  const messageStatus = params.MessageStatus ?? "";
  if (messageStatus) {
    const sid = params.MessageSid ?? params.SmsSid ?? "";
    if (sid && (messageStatus === "failed" || messageStatus === "undelivered")) {
      const code = Number(params.ErrorCode ?? "") || undefined;
      const error = explainSmsError(code, `Carrier reported ${messageStatus}${code ? ` (Twilio ${code})` : ""}.`);
      await db
        .update(reminders)
        .set({ status: "failed", error })
        .where(eq(reminders.providerSid, sid));
      await updateSmsDeliveryStatus(sid, "failed", error);
      logger.warn("sms.delivery.failed", { sid, status: messageStatus, code });
    } else if (sid && messageStatus === "delivered") {
      await updateSmsDeliveryStatus(sid, "delivered");
    }
    return twiml();
  }

  const from = params.From ?? "";
  const body = (params.Body ?? "").trim();
  const keyword = optOutKeyword(body);
  if (!from) return twiml();

  const store = (kind: "reply" | "opt_out" | "opt_in" | "help") =>
    storeInboundMessage({
      from,
      to: params.To ?? "",
      body,
      messageSid: params.MessageSid || params.SmsSid || null,
      kind,
    });

  try {
    // Which of our numbers was texted decides the opt-out's reach. A business's
    // OWN number: STOP/START applies to that business. The shared number (or
    // anything we can't match): it applies to every business, as it always has.
    // A failed lookup returns null → the broader, safer shared-number scope.
    const to = params.To ?? "";
    const dedicated = to && (STOP_WORDS.has(keyword) || START_WORDS.has(keyword))
      ? await findClientBySmsNumber(to)
      : null;
    const scope = dedicated ? { clientId: dedicated.id, businessPhone: to } : null;

    if (STOP_WORDS.has(keyword)) {
      await recordOptOut(from, keyword, scope);
      logger.info("sms.optout", {
        phone: normalizePhone(from),
        scope: scope ? "client" : "shared",
        clientId: scope?.clientId,
      });
      const inbound = await store("opt_out");
      // "Cancel my 2pm please" is a STOP keyword and also a human being asking
      // for something. Honour the carrier rule — they are opted out, and we say
      // nothing back — but don't let the message itself vanish: the business
      // still has an appointment on the books that this person wants moved.
      // A replay (same MessageSid already stored) was forwarded the first time.
      if (hasMoreThanKeyword(body) && inbound.isNew) {
        await forwardReplyToOwner(inbound.owner, params, from, body);
      }
      // Twilio's own Advanced Opt-Out sends the confirmation; stay silent here.
      return twiml();
    }
    let kind: "reply" | "opt_in" = "reply";
    if (START_WORDS.has(keyword)) {
      await removeOptOut(from, scope);
      kind = "opt_in";
      // Deliberately falls through to the reply handling below instead of
      // returning. "YES" is a START keyword AND the answer we now explicitly
      // ask for — "Reply YES to confirm or NO to reschedule". Returning here
      // meant the single most likely reply to a confirmation text resubscribed
      // someone who was never unsubscribed and told nobody anything.
    } else if (HELP_WORDS.has(keyword)) {
      await store("help");
      // Brand, contact and the rates line are all standard 10DLC audit items,
      // and /sms-consent tells people this reply will carry a number to reach.
      return twiml(
        "FrontDesk AI: appointment confirmations, reminders and follow-ups sent on behalf of local businesses. Msg&data rates may apply. Reply STOP to opt out. Help: support@frontdeskai.company",
      );
    }

    // A real reply: attach it to the most recent lead with this phone AT THE
    // BUSINESS THEY TEXTED, and hand the conversation to that owner.
    //
    // This used to search every lead on the platform. The same consumer is
    // often a lead at two businesses — they called a dentist and a plumber —
    // so a reply could stamp the wrong tenant's lead and email one business's
    // customer message to a different business. `To` is the number the
    // customer texted, which is the only trustworthy signal of who they meant.
    //
    // That reasoning holds — and it produced a dead end, because every outbound
    // text leaves from one shared sending number, so `To` matched no business
    // and every reply on the platform was dropped here with a log line. The
    // fallback is whoever last texted this person, which answers the same
    // question ("who were they talking to?") without depending on a per-tenant
    // number we don't yet issue.
    const inbound = await store(kind);
    // Smart rebooking: a reply to "we have to move your appointment — reply
    // 1, 2 or 3" is handled before anything else (including any automated
    // reply), and only for businesses that turned the feature on. Loaded
    // lazily so nothing else in this webhook pays for the booking stack.
    // Any failure here falls through to the normal owner alert.
    const owner = inbound.owner;
    if (inbound.isNew && owner?.smartRebookingEnabled) {
      try {
        const { findOpenOffer, handleRebookReply } = await import("@/lib/rebooking");
        const offer = await findOpenOffer(owner, from);
        if (offer) {
          // Calendar calls can take seconds; Twilio shouldn't wait on them.
          after(async () => {
            try {
              const outcome = await handleRebookReply(owner, offer, body);
              logger.info("sms.rebook_reply", { clientId: owner.id, result: outcome.result });
              if (outcome.alertOwner) await forwardReplyToOwner(owner, params, from, body);
            } catch (err) {
              logger.error("sms.rebook_reply_failed", {
                clientId: owner.id,
                error: err instanceof Error ? err.message : String(err),
              });
              await forwardReplyToOwner(owner, params, from, body);
            }
          });
          return twiml();
        }
      } catch (err) {
        logger.error("sms.rebook_lookup_failed", {
          clientId: owner.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    // Twilio replays a webhook it thinks failed; don't email the owner twice.
    if (inbound.isNew) await forwardReplyToOwner(inbound.owner, params, from, body);
    return twiml();
  } catch (err) {
    logger.error("webhook.twilio.failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    // 200 anyway: Twilio retries aggressively and a reply is not re-processable state.
    return twiml();
  }
}
