import "server-only";
import { db } from "@/db";
import { notifications, type Appointment, type Client, type Lead } from "@/db/schema";
import { notifier, type SendResult } from "./notifier";
import { formatDateTime, formatPhone } from "./format";
import { env } from "./env";
import { logger } from "./logger";

/**
 * Owner alerts on booking / captured message (§E2), logged to `notifications` (§E4).
 * Sends an **email** (Resend) to the client's owner email and an **SMS** (Twilio) to
 * the escalation number — each no-ops gracefully if its channel/recipient is missing.
 */
type NotificationType = (typeof notifications.$inferInsert)["type"];

function esc(s: string): string {
  return s.replace(/[<>&]/g, (c) => (c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"));
}

function ownerEmailHtml(opts: { title: string; business: string; lines: string[] }): string {
  return `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px">
  <h2 style="margin:0 0 2px;font-size:18px">${opts.title}</h2>
  <p style="color:#666;margin:0 0 16px">for ${esc(opts.business)}</p>
  ${opts.lines.map((l) => `<p style="margin:0 0 6px;font-size:15px">${l}</p>`).join("\n  ")}
  <p style="color:#999;font-size:12px;margin-top:18px">Sent by your AI receptionist · FrontDesk AI</p>
</div>`;
}

async function logNotification(
  clientId: string,
  type: NotificationType,
  channel: "email" | "sms",
  recipient: string,
  payload: unknown,
  result: SendResult,
): Promise<void> {
  await db.insert(notifications).values({
    clientId,
    type,
    channel,
    recipient,
    payload: payload as object,
    status: result.skipped ? "queued" : result.ok ? "sent" : "failed",
    sentAt: result.ok ? new Date() : null,
  });
}

export async function notifyOwnerBooking(client: Client, appt: Appointment): Promise<void> {
  const who = appt.customerName ?? "a caller";
  const when = formatDateTime(appt.startAt, client.timezone);
  const phone = formatPhone(appt.customerPhone);
  const sms = client.escalationNumber?.trim();
  const email = client.ownerEmail?.trim();

  if (sms) {
    const body = `📅 New booking for ${client.name}: ${who} on ${when}. Callback: ${phone}`;
    const r = await notifier.sendSms({ to: sms, body });
    await logNotification(client.id, "booking", "sms", sms, { body, appointmentId: appt.id }, r);
  }
  if (email) {
    const subject = `New booking — ${who}`;
    const r = await notifier.sendEmail({
      to: email,
      subject,
      html: ownerEmailHtml({
        title: "📅 New booking",
        business: client.name,
        lines: [`<strong>${esc(who)}</strong> — ${esc(when)}`, `Callback: ${phone}`],
      }),
      text: `New booking for ${client.name}: ${who} on ${when}. Callback: ${phone}`,
    });
    await logNotification(client.id, "booking", "email", email, { subject, appointmentId: appt.id }, r);
  }
  if (!sms && !email) logger.info("notify.booking.no_owner_contact", { clientId: client.id });
}

export async function notifyOwnerLead(client: Client, lead: Lead): Promise<void> {
  const who = lead.name ?? "a caller";
  const phone = formatPhone(lead.phone);
  const sms = client.escalationNumber?.trim();
  const email = client.ownerEmail?.trim();

  if (sms) {
    const body = `📨 New message for ${client.name}: ${who} (${phone})${lead.reason ? ` — ${lead.reason}` : ""}`;
    const r = await notifier.sendSms({ to: sms, body });
    await logNotification(client.id, "lead", "sms", sms, { body, leadId: lead.id }, r);
  }
  if (email) {
    const subject = `New message — ${who}`;
    const r = await notifier.sendEmail({
      to: email,
      subject,
      html: ownerEmailHtml({
        title: "📨 New message",
        business: client.name,
        lines: [
          `<strong>${esc(who)}</strong>${lead.phone ? ` · ${phone}` : ""}`,
          lead.reason ? `Reason: ${esc(lead.reason)}` : "",
          lead.message ? `&ldquo;${esc(lead.message)}&rdquo;` : "",
        ].filter(Boolean),
      }),
      text: `New message for ${client.name}: ${who} (${phone})${lead.reason ? ` — ${lead.reason}` : ""}${lead.message ? `\n"${lead.message}"` : ""}`,
    });
    await logNotification(client.id, "lead", "email", email, { subject, leadId: lead.id }, r);
  }
  if (!sms && !email) logger.info("notify.lead.no_owner_contact", { clientId: client.id });
}

/** Agent #1 → owner: "Your AI learned N things — approve to teach it." */
export async function notifyOwnerLearnings(
  client: Client,
  items: string[],
): Promise<void> {
  const email = client.ownerEmail?.trim();
  if (!email || items.length === 0) return;

  const base = env.APP_URL.replace(/\/$/, "");
  const subject = `Your AI learned ${items.length} thing${items.length === 1 ? "" : "s"} from this week's calls`;
  const r = await notifier.sendEmail({
    to: email,
    subject,
    html: ownerEmailHtml({
      title: "🎓 Your AI wants to learn",
      business: client.name,
      lines: [
        `It listened to its own calls and drafted ${items.length} improvement${items.length === 1 ? "" : "s"}:`,
        ...items.slice(0, 5).map((q) => `• ${esc(q)}`),
        `<a href="${base}/portal">Review and approve →</a> Nothing changes until you approve.`,
      ],
    }),
    text: `Your AI drafted ${items.length} improvement(s) from real calls:\n${items
      .slice(0, 5)
      .map((q) => `- ${q}`)
      .join("\n")}\n\nReview at ${base}/portal — nothing changes until you approve.`,
  });
  await logNotification(client.id, "system", "email", email, { subject, kind: "learnings", count: items.length }, r);
}

/** Agent #3 → operator: a graded call carries compliance risk. */
export async function notifyOperatorComplianceRisk(
  client: Client,
  operatorEmail: string,
  flaggedCalls: number,
): Promise<void> {
  if (!operatorEmail.trim() || flaggedCalls === 0) return;

  const base = env.APP_URL.replace(/\/$/, "");
  const subject = `⚠ Compliance flag — ${client.name} (${flaggedCalls} call${flaggedCalls === 1 ? "" : "s"})`;
  const r = await notifier.sendEmail({
    to: operatorEmail,
    subject,
    html: ownerEmailHtml({
      title: "⚠ QA flagged compliance risk",
      business: client.name,
      lines: [
        `The QA agent flagged ${flaggedCalls} call${flaggedCalls === 1 ? "" : "s"} with possible compliance risk (off-policy promises, disclosure issues, or advice with legal exposure).`,
        `<a href="${base}/review">Open the review queue →</a>`,
      ],
    }),
    text: `QA flagged ${flaggedCalls} call(s) for ${client.name} with possible compliance risk. Review: ${base}/review`,
  });
  await logNotification(
    client.id,
    "system",
    "email",
    operatorEmail,
    { subject, kind: "compliance_risk", count: flaggedCalls },
    r,
  );
}
