import "server-only";
import { Resend } from "resend";
import twilio from "twilio";
import { env, integrations, webhookUrl } from "./env";
import { logger } from "./logger";
import { recordOutboundSms, type OutboundLogContext } from "./data/sms-messages";
import { getClientSmsNumber } from "./data/sms-numbers";
import { samePhone, toE164, type TwilioNumberCheck } from "./sms-number-format";

export type { TwilioNumberCheck };

/**
 * Notifier (§EPIC E): email via Resend, SMS via Twilio, behind one interface.
 * Both channels no-op (return { skipped: true }) when their keys are absent, so
 * local dev and CI never crash on a missing integration. Callers persist a
 * `notifications` row from the returned result (E4) — wired in Phase 1.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  /** Who a reply goes to — used by the contact form so hitting Reply reaches them. */
  replyTo?: string;
}

export interface SmsMessage {
  to: string;
  body: string;
  /**
   * Set on texts to a business's CUSTOMER so the message lands in that
   * business's Messages inbox (sms_messages) next to any reply. Leave unset for
   * texts to the owner/staff (alerts, digests) and for one-time codes.
   */
  log?: OutboundLogContext;
  /**
   * The business this text is sent on behalf of, when it isn't already given
   * by `log.clientId` (e.g. one-time cancel codes, which aren't logged). If
   * that business has its own texting number the text goes out from it;
   * otherwise from the shared TWILIO_FROM_NUMBER. Leave unset for owner/staff
   * alerts and digests — those always come from the shared number.
   */
  fromClientId?: string;
}

export interface SendResult {
  ok: boolean;
  id?: string;
  skipped?: boolean;
  error?: string;
  /** Twilio's numeric error code, when it gave us one (e.g. 20003, 21610). */
  code?: number;
}

async function sendEmail(msg: EmailMessage): Promise<SendResult> {
  if (!integrations.resend()) {
    logger.warn("notifier.email.skipped", { reason: "RESEND_API_KEY unset", to: msg.to });
    return { ok: false, skipped: true };
  }
  try {
    const resend = new Resend(env.RESEND_API_KEY);
    const base = {
      from: env.RESEND_FROM,
      to: msg.to,
      subject: msg.subject,
      ...(msg.replyTo ? { replyTo: msg.replyTo } : {}),
    };
    const options = msg.html
      ? { ...base, html: msg.html, text: msg.text }
      : { ...base, text: msg.text ?? "" };
    const { data, error } = await resend.emails.send(options);
    if (error) {
      logger.error("notifier.email.failed", { to: msg.to, error: error.message });
      return { ok: false, error: error.message };
    }
    return { ok: true, id: data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("notifier.email.threw", { to: msg.to, error: message });
    return { ok: false, error: message };
  }
}

/**
 * Twilio's error, in words the person reading it can act on.
 *
 * This exists because of an expensive silence. Production's Twilio credentials
 * were being rejected — every booking confirmation, every reminder and every
 * follow-up text had been failing for days — and all it produced was one word
 * in a database column, "Authenticate", and a toast reading "please try again".
 * Trying again does not fix a rejected credential. Whoever is looking at the
 * screen needs to be told which thing is broken and whether it's theirs to fix.
 */
export function explainSmsError(code: number | undefined, fallback: string): string {
  switch (code) {
    case 20003:
      return "Texting is rejecting our credentials, so nothing can be sent. That's on us to fix — please let support know.";
    case 21610:
      return "This number replied STOP, so carriers won't deliver to them. They'd have to text START to your number first.";
    case 21408:
    case 21606:
    case 21612:
      return "Your texting number can't send to that number. Try calling them instead.";
    case 21211:
    case 21214:
    case 21614:
      return "That doesn't look like a mobile number that can receive texts.";
    case 30034:
      return "Your texting number isn't registered for business messaging yet, so carriers are blocking it.";
    case 20429:
      return "Texting is rate-limited right now — give it a minute and try again.";
    default:
      return fallback;
  }
}

/** Twilio throws RestException, which carries a numeric `code` alongside the message. */
function twilioErrorCode(err: unknown): number | undefined {
  const code = (err as { code?: unknown })?.code;
  return typeof code === "number" ? code : undefined;
}

async function sendSms(msg: SmsMessage): Promise<SendResult> {
  if (!integrations.twilio()) {
    logger.warn("notifier.sms.skipped", { reason: "Twilio env unset", to: msg.to });
    return { ok: false, skipped: true };
  }
  const from = await senderNumberFor(msg);
  try {
    const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
    const res = await client.messages.create({
      from,
      to: msg.to,
      body: msg.body,
      // "ok" from this call means Twilio accepted the message, nothing more.
      // The carrier's verdict arrives minutes later at this callback — without
      // it, a text bounced by the carrier stays recorded as sent forever.
      statusCallback: webhookUrl("/api/webhooks/twilio"),
    });
    await logToInbox(msg, from, { ok: true, id: res.sid });
    return { ok: true, id: res.sid };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = twilioErrorCode(err);
    // Keep the code in the stored/logged text. "Authenticate" on its own cost
    // days of not knowing which of five things was wrong.
    const detail = code ? `${message} (Twilio ${code})` : message;
    logger.error("notifier.sms.threw", { to: msg.to, error: detail, code });
    await logToInbox(msg, from, { ok: false, error: detail });
    return { ok: false, error: detail, code };
  }
}

/**
 * Which of our numbers a text leaves from: the business's own number when it
 * has one, else the shared number. Never throws — a failed lookup falls back
 * to the shared number, which is how every text went out before.
 */
export async function senderNumberFor(msg: Pick<SmsMessage, "log" | "fromClientId">): Promise<string> {
  const clientId = msg.fromClientId ?? msg.log?.clientId;
  if (!clientId) return env.TWILIO_FROM_NUMBER;
  const own = await getClientSmsNumber(clientId);
  return own || env.TWILIO_FROM_NUMBER;
}

/** Best-effort: record a customer text in the inbox. Never throws. */
async function logToInbox(msg: SmsMessage, from: string, result: SendResult): Promise<void> {
  if (!msg.log) return;
  await recordOutboundSms(msg.log, {
    to: msg.to,
    from: from || null,
    body: msg.body,
    ok: result.ok,
    providerSid: result.id ?? null,
    error: result.error ?? null,
  });
}

/**
 * Read-only look at a number in OUR Twilio account, used when an operator
 * assigns a business its own texting number. Never buys, releases or edits
 * anything — it only answers "is this pasted number really ours, can it text,
 * and will replies reach us?".
 */
export async function checkTwilioNumber(raw: string): Promise<TwilioNumberCheck> {
  const e164 = toE164(raw) ?? raw;
  const isShared = samePhone(e164, env.TWILIO_FROM_NUMBER);
  const empty = { found: false, smsCapable: false, webhookOk: false, smsUrl: null, isShared };
  if (!integrations.twilio()) return { checked: false, ...empty };
  const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  const matches = await client.incomingPhoneNumbers.list({ phoneNumber: e164, limit: 1 });
  const n = matches[0];
  if (!n) return { checked: true, ...empty };
  const smsUrl = n.smsUrl || null;
  const expected = webhookUrl("/api/webhooks/twilio");
  const webhookOk = Boolean(smsUrl && smsUrl.replace(/\/$/, "") === expected.replace(/\/$/, ""));
  return {
    checked: true,
    found: true,
    smsCapable: n.capabilities?.sms !== false,
    // Advisory only: a number inside a Messaging Service may route inbound via
    // the service's own setting, which this lookup can't see.
    webhookOk,
    smsUrl,
    isShared,
  };
}

export const notifier = { sendEmail, sendSms };
export type Notifier = typeof notifier;
