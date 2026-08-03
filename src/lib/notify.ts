import "server-only";
import { db } from "@/db";
import { notifications, type Appointment, type Client, type Lead } from "@/db/schema";
import { notifier, type SendResult } from "./notifier";
import { getAlertRecipients } from "./data/alert-contacts";
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
  const { emails, phones } = await getAlertRecipients(client);
  const smsTargets = client.smsAlertsEnabled ? phones : [];

  for (const sms of smsTargets) {
    const body = `📅 New booking for ${client.name}: ${who} on ${when}. Callback: ${phone}`;
    const r = await notifier.sendSms({ to: sms, body });
    await logNotification(client.id, "booking", "sms", sms, { body, appointmentId: appt.id }, r);
  }
  for (const email of emails) {
    const subject = `New booking — ${who}`;
    const r = await notifier.sendEmail({
      to: email,
      subject,
      html: ownerEmailHtml({
        title: "📅 New booking",
        business: client.name,
        lines: [
          `<strong>${esc(who)}</strong> — ${esc(when)}`,
          `Callback: ${phone}`,
          ...(appt.meetingUrl
            ? [`Video visit: <a href="${esc(appt.meetingUrl)}">${esc(appt.meetingUrl)}</a>`]
            : []),
        ],
      }),
      text: `New booking for ${client.name}: ${who} on ${when}. Callback: ${phone}`,
    });
    await logNotification(client.id, "booking", "email", email, { subject, appointmentId: appt.id }, r);
  }
  if (!smsTargets.length && !emails.length)
    logger.info("notify.booking.no_owner_contact", { clientId: client.id });
}

/** Owner alert when an appointment is cancelled (by phone or from the portal). */
export async function notifyOwnerCancellation(
  client: Client,
  appt: Appointment,
  source: "phone" | "portal",
): Promise<void> {
  // Portal cancellations are the owner's own doing — no alert needed.
  if (source === "portal") return;
  const who = appt.customerName ?? "A caller";
  const when = formatDateTime(appt.startAt, client.timezone);
  const phone = formatPhone(appt.customerPhone);
  const { emails, phones } = await getAlertRecipients(client);
  const smsTargets = client.smsAlertsEnabled ? phones : [];

  for (const sms of smsTargets) {
    const body = `🚫 Cancellation for ${client.name}: ${who} cancelled ${when} by phone. Callback: ${phone}`;
    const r = await notifier.sendSms({ to: sms, body });
    await logNotification(client.id, "system", "sms", sms, { body, appointmentId: appt.id }, r);
  }
  for (const email of emails) {
    const subject = `Cancellation — ${who}`;
    const r = await notifier.sendEmail({
      to: email,
      subject,
      html: ownerEmailHtml({
        title: "🚫 Appointment cancelled",
        business: client.name,
        lines: [
          `<strong>${esc(who)}</strong> cancelled <strong>${esc(when)}</strong> over the phone.`,
          `Callback: ${phone}`,
          `The slot is open again — your AI can rebook it.`,
        ],
      }),
      text: `Cancellation for ${client.name}: ${who} cancelled ${when} by phone. Callback: ${phone}`,
    });
    await logNotification(client.id, "system", "email", email, { subject, appointmentId: appt.id }, r);
  }
  if (!smsTargets.length && !emails.length)
    logger.info("notify.cancellation.no_owner_contact", { clientId: client.id });
}

export async function notifyOwnerLead(client: Client, lead: Lead): Promise<void> {
  const who = lead.name ?? "a caller";
  const phone = formatPhone(lead.phone);
  const { emails, phones } = await getAlertRecipients(client);
  const smsTargets = client.smsAlertsEnabled ? phones : [];
  // The AI captures urgency on the call ("ASAP", "emergency", "today") — lead
  // with urgent language gets an unmissable prefix so it never sits till morning.
  const urgent = /asap|urgent|emergenc|right away|immediately|today|leak|flood|burst/i.test(
    `${lead.urgency ?? ""} ${lead.reason ?? ""}`,
  );

  for (const sms of smsTargets) {
    const body = `${urgent ? "🚨 EMERGENCY — " : "📨 "}New message for ${client.name}: ${who} (${phone})${lead.reason ? ` — ${lead.reason}` : ""}`;
    const r = await notifier.sendSms({ to: sms, body });
    await logNotification(client.id, "lead", "sms", sms, { body, leadId: lead.id }, r);
  }
  for (const email of emails) {
    const subject = urgent ? `🚨 URGENT — ${who} needs a call back` : `New message — ${who}`;
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
  if (!smsTargets.length && !emails.length)
    logger.info("notify.lead.no_owner_contact", { clientId: client.id });
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

/**
 * Tell the owner NOW when a call went badly in a way that can still be saved.
 *
 * The dashboard panel is retrospective — it's there so nobody discovers a
 * problem from an angry customer a week later. This is the other half: two
 * failures are worth interrupting someone's day over, because both have a
 * window in which a callback still fixes them.
 *
 * A caller who asked for a person and didn't get one is a customer who is,
 * right now, deciding whether to try a competitor. And a call that mentioned
 * something urgent is the failure with the worst ratio of consequence to
 * visibility in this whole product — it never becomes a bad review.
 *
 * Deliberately narrow. Alert on everything and the owner mutes us, which costs
 * more than sending nothing.
 */
export async function notifyOwnerCallProblem(
  client: Client,
  call: { id: string; fromNumber: string | null; startAt: Date | null },
  health: { problems: string[]; notes: string[] },
): Promise<void> {
  const urgent = health.problems.includes("possible_emergency");
  const stranded = health.problems.includes("stranded_asking_for_human");
  if (!urgent && !stranded) return;

  const phone = formatPhone(call.fromNumber);
  const when = formatDateTime(call.startAt, client.timezone);
  const headline = urgent
    ? `A caller may have had an emergency`
    : `A caller asked for a person and didn't get one`;
  const action = urgent
    ? "Listen to this one first, then call them back."
    : "They're deciding whether to try someone else. A callback now usually saves it.";
  const link = `${env.APP_URL.replace(/\/$/, "")}/portal/calls/${call.id}`;

  const { emails, phones } = await getAlertRecipients(client);
  const smsTargets = client.smsAlertsEnabled ? phones : [];

  for (const sms of smsTargets) {
    const body = `${urgent ? "🚨" : "⚠️"} ${client.name}: ${headline}. ${phone} at ${when}. ${action} ${link}`;
    const r = await notifier.sendSms({ to: sms, body });
    await logNotification(client.id, "system", "sms", sms, { body, callId: call.id }, r);
  }

  for (const to of emails) {
    const html = ownerEmailHtml({
      title: headline,
      business: client.name,
      lines: [
        ...health.notes.map((n) => esc(n)),
        `<strong>Caller:</strong> ${esc(phone)} · ${esc(when)}`,
        `<strong>${esc(action)}</strong>`,
        `<a href="${link}">Listen to the call</a>`,
      ],
    });
    const r = await notifier.sendEmail({
      to,
      subject: `${urgent ? "Urgent — " : ""}${headline} · ${client.name}`,
      html,
      text: `${headline}. ${health.notes.join(" ")} Caller ${phone} at ${when}. ${action} ${link}`,
    });
    await logNotification(client.id, "system", "email", to, { headline, callId: call.id }, r);
  }

  logger.info("notify.call_problem", {
    clientId: client.id,
    callId: call.id,
    problems: health.problems,
  });
}
