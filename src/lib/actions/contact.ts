"use server";

import { notifier } from "@/lib/notifier";
import { logger } from "@/lib/logger";
import { type ActionState } from "./types";

/**
 * The message a stranger sends before they're a customer.
 *
 * Deliberately unauthenticated — it's the page someone lands on to ask for a
 * trial, and requiring an account first is the thing that made it useless.
 * Which means everything here has to survive being posted by anybody:
 * hard length caps, a header-injection guard on the reply-to address, and no
 * echo of the input back into HTML without escaping.
 */

const OWNER_EMAIL = "arigberkowitz@gmail.com";
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const LIMITS = { name: 80, email: 200, subject: 120, message: 4000 } as const;

const esc = (s: string) =>
  s.replace(/[<>&]/g, (c) => (c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"));

export async function sendContactMessageAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const field = (key: keyof typeof LIMITS) =>
    String(formData.get(key) ?? "").trim().slice(0, LIMITS[key]);

  const name = field("name");
  const email = field("email");
  const subject = field("subject");
  const message = field("message");

  // A bot fills every field it can see, including the one nobody can. Cheaper
  // and less hostile than a CAPTCHA, and it lies to the bot rather than to a
  // person who mistyped something.
  if (String(formData.get("company") ?? "").trim()) {
    logger.info("contact.honeypot");
    return { ok: true, message: "Thanks — I'll get back to you." };
  }

  const fieldErrors: Record<string, string[]> = {};
  if (!email) fieldErrors.email = ["We need an email to reply to"];
  else if (!EMAIL_RE.test(email)) fieldErrors.email = ["That doesn't look like an email address"];
  if (!message) fieldErrors.message = ["Tell us what you need"];
  if (Object.keys(fieldErrors).length) return { ok: false, fieldErrors };

  // Newlines in a header field are how a stranger adds their own Bcc.
  const replyTo = /[\r\n]/.test(email) ? undefined : email;
  const cleanSubject = subject.replace(/[\r\n]/g, " ") || "Message from the website";

  const result = await notifier.sendEmail({
    to: OWNER_EMAIL,
    replyTo,
    subject: `FrontDesk AI — ${cleanSubject}`,
    html:
      `<p><strong>${esc(name || "Someone")}</strong> &lt;${esc(email)}&gt; wrote:</p>` +
      `<blockquote style="white-space:pre-wrap">${esc(message)}</blockquote>`,
    text: `${name || "Someone"} <${email}> wrote:\n\n${message}`,
  });

  if (result.skipped) {
    logger.error("contact.not_configured", {
      detail: "Somebody tried to get in touch and email isn't connected — the message is lost.",
    });
    return {
      ok: false,
      error: `Our email isn't connected right now. Write to ${OWNER_EMAIL} directly and it'll get there.`,
    };
  }
  if (!result.ok) {
    logger.error("contact.send_failed", { error: result.error });
    return {
      ok: false,
      error: `That didn't send. Write to ${OWNER_EMAIL} directly — sorry about this.`,
    };
  }

  logger.info("contact.sent", { subject: cleanSubject });
  return { ok: true, message: "Sent — I'll get back to you." };
}
