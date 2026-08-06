import "server-only";
import { Resend } from "resend";
import twilio from "twilio";
import { env, integrations } from "./env";
import { logger } from "./logger";

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
  try {
    const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
    const res = await client.messages.create({
      from: env.TWILIO_FROM_NUMBER,
      to: msg.to,
      body: msg.body,
    });
    return { ok: true, id: res.sid };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = twilioErrorCode(err);
    // Keep the code in the stored/logged text. "Authenticate" on its own cost
    // days of not knowing which of five things was wrong.
    const detail = code ? `${message} (Twilio ${code})` : message;
    logger.error("notifier.sms.threw", { to: msg.to, error: detail, code });
    return { ok: false, error: detail, code };
  }
}

export const notifier = { sendEmail, sendSms };
export type Notifier = typeof notifier;
