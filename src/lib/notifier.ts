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
}

async function sendEmail(msg: EmailMessage): Promise<SendResult> {
  if (!integrations.resend()) {
    logger.warn("notifier.email.skipped", { reason: "RESEND_API_KEY unset", to: msg.to });
    return { ok: false, skipped: true };
  }
  try {
    const resend = new Resend(env.RESEND_API_KEY);
    const base = { from: env.RESEND_FROM, to: msg.to, subject: msg.subject };
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
    logger.error("notifier.sms.threw", { to: msg.to, error: message });
    return { ok: false, error: message };
  }
}

export const notifier = { sendEmail, sendSms };
export type Notifier = typeof notifier;
