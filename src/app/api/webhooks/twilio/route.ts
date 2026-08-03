import { createHmac, timingSafeEqual } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { leads } from "@/db/schema";
import { recordOptOut, removeOptOut, normalizePhone } from "@/lib/data/sms-optouts";
import { findClientByPhone } from "@/lib/data/clients";
import { notifier } from "@/lib/notifier";
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
 *     stands down) and forward the message to the business owner by email.
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

  const from = params.From ?? "";
  const body = (params.Body ?? "").trim();
  const keyword = body.toLowerCase().replace(/[^a-z]/g, "");
  if (!from) return twiml();

  try {
    if (STOP_WORDS.has(keyword)) {
      await recordOptOut(from, keyword);
      logger.info("sms.optout", { phone: normalizePhone(from) });
      // Twilio's own Advanced Opt-Out sends the confirmation; stay silent here.
      return twiml();
    }
    if (START_WORDS.has(keyword)) {
      await removeOptOut(from);
      return twiml();
    }
    if (HELP_WORDS.has(keyword)) {
      return twiml(
        "This number sends appointment reminders and follow-ups on behalf of local businesses. Reply STOP to opt out.",
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
    const to = params.To ?? "";
    const owner = to ? await findClientByPhone(to) : null;
    if (!owner) {
      logger.warn("sms.reply.unknown_recipient", { to: normalizePhone(to) });
      return twiml();
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
      const ownerEmail = owner.ownerEmail?.trim();
      if (ownerEmail) {
        await notifier.sendEmail({
          to: ownerEmail,
          subject: `${lead.name ?? "A lead"} texted back`,
          html: `<p><strong>${lead.name ?? "A lead"}</strong> (${from}) replied:</p><blockquote>${body
            .slice(0, 500)
            .replace(/[<>&]/g, (c) => (c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"))}</blockquote><p>Automated follow-ups for this lead are paused — the conversation is yours now.</p>`,
          text: `${lead.name ?? "A lead"} (${from}) replied: ${body.slice(0, 500)}\n\nAutomated follow-ups are paused — the conversation is yours now.`,
        });
      }
    } else {
      logger.info("sms.reply.no_lead", { clientId: owner.id, phone: digits });
    }
    return twiml();
  } catch (err) {
    logger.error("webhook.twilio.failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    // 200 anyway: Twilio retries aggressively and a reply is not re-processable state.
    return twiml();
  }
}
