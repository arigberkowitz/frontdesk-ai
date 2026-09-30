import "server-only";
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { notifications, type Client } from "@/db/schema";
import { getAlertRecipients } from "@/lib/data/alert-contacts";
import { notifier } from "@/lib/notifier";
import { formatPhone } from "@/lib/format";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Reply alerts: a customer texted the business → email whoever gets alerts.
 *
 *  - **Email only.** The alert phone (escalation number / roster phones) is
 *    never texted for these. A back-and-forth with a customer can be a dozen
 *    messages, and the owner's cell is the one channel we can't afford to
 *    make noisy.
 *  - **Who:** the same routing as every other owner alert —
 *    `getAlertRecipients` (on-duty alert roster, on-the-clock staff, else the
 *    owner email). Emails only; its phones are ignored.
 *  - **Throttled per conversation:** at most one alert per customer thread per
 *    `REPLY_ALERT_THROTTLE_MINUTES`. A burst of five texts is one email; the
 *    rest are waiting in Messages (with the unread badge). A failed send does
 *    not count, so the next text tries again.
 *  - **Recorded** in `notifications` (type `system`, payload.kind `sms_reply`),
 *    which is also what the throttle reads — no new table or migration.
 */

export const REPLY_ALERT_THROTTLE_MINUTES = 15;
export const REPLY_ALERT_KIND = "sms_reply";

function esc(s: string): string {
  return s.replace(/[<>&"]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&amp;",
  );
}

export interface ReplyAlertEmailInput {
  business: string;
  /** Contact name if we know one, else null (the phone is used). */
  name: string | null;
  customerPhone: string;
  body: string;
  link: string;
  /** A lead's automated follow-ups were just paused by this reply. */
  followUpsPaused: boolean;
}

/** Subject/html/text for one reply alert. Pure, so it can be tested. */
export function replyAlertEmail(input: ReplyAlertEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const phone = formatPhone(input.customerPhone);
  const who = input.name?.trim() || phone;
  const snippet = input.body.replace(/\s+/g, " ").trim();
  const short = snippet.length > 60 ? `${snippet.slice(0, 57)}…` : snippet;
  const full = snippet.slice(0, 500);
  const subject = short ? `${who} texted ${input.business}: "${short}"` : `${who} texted ${input.business}`;
  const burstNote = `More texts in this conversation over the next ${REPLY_ALERT_THROTTLE_MINUTES} minutes won't send another email — they'll be waiting in Messages.`;
  const pausedNote = "Automated follow-ups for this customer are paused — the conversation is yours now.";

  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px">
  <h2 style="margin:0 0 2px;font-size:18px">💬 New text from ${esc(who)}</h2>
  <p style="color:#666;margin:0 0 16px">for ${esc(input.business)}${input.name ? ` · ${esc(phone)}` : ""}</p>
  ${full ? `<blockquote style="margin:0 0 14px;padding:10px 12px;border-left:3px solid #6366f1;background:#f5f5ff;font-size:15px">${esc(full)}</blockquote>` : ""}
  <p style="margin:0 0 14px"><a href="${esc(input.link)}" style="background:#111;color:#fff;text-decoration:none;padding:9px 16px;border-radius:8px;font-size:14px;display:inline-block">Read &amp; reply in Messages</a></p>
  ${input.followUpsPaused ? `<p style="margin:0 0 6px;font-size:14px">${pausedNote}</p>` : ""}
  <p style="color:#999;font-size:12px;margin-top:18px">${burstNote}<br>Sent by your AI receptionist · FrontDesk AI</p>
</div>`;
  const text = [
    `New text from ${who}${input.name ? ` (${phone})` : ""} for ${input.business}:`,
    full ? `"${full}"` : "",
    `Read & reply: ${input.link}`,
    input.followUpsPaused ? pausedNote : "",
    burstNote,
  ]
    .filter(Boolean)
    .join("\n\n");
  return { subject, html, text };
}

/**
 * Atomically decide whether this conversation may alert now and, if so, claim
 * it by writing one queued `notifications` row per recipient. An advisory lock
 * on (business, customer) serializes two texts landing at the same instant, so
 * a burst can't slip two emails past the check.
 *
 * Returns the claimed rows, or null when throttled.
 */
async function claimReplyAlert(
  clientId: string,
  customerPhone: string,
  recipients: string[],
  payload: Record<string, unknown>,
): Promise<{ id: string; recipient: string }[] | null> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`reply-alert:${clientId}:${customerPhone}`}))`,
    );
    const recent = await tx
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.clientId, clientId),
          sql`${notifications.payload}->>'kind' = ${REPLY_ALERT_KIND}`,
          sql`${notifications.payload}->>'customerPhone' = ${customerPhone}`,
          ne(notifications.status, "failed"),
          sql`${notifications.createdAt} > now() - make_interval(mins => ${REPLY_ALERT_THROTTLE_MINUTES})`,
        ),
      )
      .limit(1);
    if (recent.length > 0) return null;
    return tx
      .insert(notifications)
      .values(
        recipients.map((recipient) => ({
          clientId,
          type: "system" as const,
          channel: "email" as const,
          recipient,
          payload,
          status: "queued" as const,
        })),
      )
      .returning({ id: notifications.id, recipient: notifications.recipient });
  });
}

export type ReplyAlertResult =
  | { status: "sent"; sent: number; failed: number }
  | { status: "throttled" }
  | { status: "no_recipient" };

/**
 * Email the business's alert recipients about an inbound customer text.
 * Callers only invoke this for a NEW message (not a Twilio replay) that a
 * human wrote (replies, YES/START, or STOP-with-a-message — not bare keywords).
 * Never texts anyone.
 */
export async function notifyOwnerTextReply(
  client: Client,
  input: {
    /** Normalized digits, the same key `sms_messages.customer_phone` uses. */
    customerPhone: string;
    body: string;
    name?: string | null;
    followUpsPaused?: boolean;
  },
): Promise<ReplyAlertResult> {
  const { emails } = await getAlertRecipients(client);
  if (emails.length === 0) {
    logger.info("notify.sms_reply.no_owner_email", { clientId: client.id });
    return { status: "no_recipient" };
  }

  const link = `${env.APP_URL.replace(/\/$/, "")}/portal/messages/${input.customerPhone}`;
  const email = replyAlertEmail({
    business: client.name,
    name: input.name ?? null,
    customerPhone: input.customerPhone,
    body: input.body,
    link,
    followUpsPaused: Boolean(input.followUpsPaused),
  });

  const claimed = await claimReplyAlert(client.id, input.customerPhone, emails, {
    kind: REPLY_ALERT_KIND,
    customerPhone: input.customerPhone,
    subject: email.subject,
  });
  if (!claimed) {
    logger.info("notify.sms_reply.throttled", { clientId: client.id });
    return { status: "throttled" };
  }

  let sent = 0;
  let failed = 0;
  for (const row of claimed) {
    const r = await notifier.sendEmail({
      to: row.recipient,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
    // Skipped (no Resend key) stays "queued", like every other owner alert.
    const status = r.skipped ? "queued" : r.ok ? "sent" : "failed";
    if (r.ok) sent++;
    else if (!r.skipped) failed++;
    await db
      .update(notifications)
      .set({ status, sentAt: r.ok ? new Date() : null })
      .where(eq(notifications.id, row.id));
  }
  logger.info("notify.sms_reply", { clientId: client.id, sent, failed });
  return { status: "sent", sent, failed };
}
