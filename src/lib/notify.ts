import "server-only";
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { notifications, type Appointment, type Client, type Lead } from "@/db/schema";
import { notifier, type SendResult } from "./notifier";
import { getAlertRecipients } from "./data/alert-contacts";
import { formatDateTime, formatDateTimeWithZone, formatPhone, toE164 } from "./format";
import { env } from "./env";
import { logger } from "./logger";
import { pushToClient } from "./push";
import { bookingPushPayload } from "./push-payloads";

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
  // Phone notification to every device the owner opted in. No-op without
  // VAPID keys or devices; never throws; 4s cap per device.
  const push = pushToClient(
    client.id,
    "booking",
    bookingPushPayload({
      appointmentId: appt.id,
      customerName: appt.customerName,
      customerPhone: appt.customerPhone,
      startAt: appt.startAt,
      timeZone: client.timezone,
    }),
  );
  const who = appt.customerName ?? "a caller";
  const when = formatDateTime(appt.startAt, client.timezone);
  const phone = formatPhone(appt.customerPhone);
  const { emails, phones } = await getAlertRecipients(client);
  const smsTargets = client.smsAlertsEnabled ? phones : [];

  for (const sms of smsTargets) {
    const body = `📅 New booking for ${client.name}: ${who} on ${when}. Callback: ${phone}${appt.serviceAddress ? ` · At: ${appt.serviceAddress}` : ""}`;
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
          ...(appt.serviceAddress ? [`Address: ${esc(appt.serviceAddress)}`] : []),
          ...(appt.meetingUrl
            ? [`Video visit: <a href="${esc(appt.meetingUrl)}">${esc(appt.meetingUrl)}</a>`]
            : []),
        ],
      }),
      text: `New booking for ${client.name}: ${who} on ${when}. Callback: ${phone}${appt.serviceAddress ? `\nAddress: ${appt.serviceAddress}` : ""}`,
    });
    await logNotification(client.id, "booking", "email", email, { subject, appointmentId: appt.id }, r);
  }
  // Started first so it overlaps the SMS/email sends (this runs while the
  // caller is still on the line); awaited so it finishes inside the request.
  await push;
  if (!smsTargets.length && !emails.length)
    logger.info("notify.booking.no_owner_contact", { clientId: client.id });
}

/** Owner alert when an appointment is cancelled (by phone or from the portal). */
export async function notifyOwnerCancellation(
  client: Client,
  appt: Appointment,
  source: "phone" | "chat" | "text" | "portal",
): Promise<void> {
  // Portal cancellations are the owner's own doing — no alert needed.
  if (source === "portal") return;
  const via =
    source === "chat" ? "via your website chat" : source === "text" ? "by text (AI reply)" : "by phone";
  const who = appt.customerName ?? "A caller";
  const when = formatDateTime(appt.startAt, client.timezone);
  const phone = formatPhone(appt.customerPhone);
  const { emails, phones } = await getAlertRecipients(client);
  const smsTargets = client.smsAlertsEnabled ? phones : [];

  for (const sms of smsTargets) {
    const body = `🚫 Cancellation for ${client.name}: ${who} cancelled ${when} ${via}. Callback: ${phone}`;
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
          `<strong>${esc(who)}</strong> cancelled <strong>${esc(when)}</strong> ${esc(via)}.`,
          `Callback: ${phone}`,
          `The slot is open again — your AI can rebook it.`,
        ],
      }),
      text: `Cancellation for ${client.name}: ${who} cancelled ${when} ${via}. Callback: ${phone}`,
    });
    await logNotification(client.id, "system", "email", email, { subject, appointmentId: appt.id }, r);
  }
  if (!smsTargets.length && !emails.length)
    logger.info("notify.cancellation.no_owner_contact", { clientId: client.id });
}

export async function notifyOwnerLead(
  client: Client,
  lead: Lead,
  opts: { emergency?: boolean } = {},
): Promise<void> {
  const who = lead.name ?? "a caller";
  const phone = formatPhone(lead.phone);
  const { emails, phones } = await getAlertRecipients(client);
  // An emergency is texted even with routine SMS alerts off — that switch is
  // about not being pinged for every message, not about a flooded basement —
  // and also to the on-call number when the business set one.
  const onCall = toE164(client.setupFlags?.emergency?.onCallNumber);
  const smsTargets = opts.emergency
    ? [...new Set([...phones, ...(onCall ? [onCall] : [])])]
    : client.smsAlertsEnabled
      ? phones
      : [];
  // The AI captures urgency on the call ("ASAP", "emergency", "today") — lead
  // with urgent language gets an unmissable prefix so it never sits till morning.
  const urgent = opts.emergency === true || /asap|urgent|emergenc|right away|immediately|today|leak|flood|burst/i.test(
    `${lead.urgency ?? ""} ${lead.reason ?? ""}`,
  );

  for (const sms of smsTargets) {
    const body = `${urgent ? "🚨 EMERGENCY — " : "📨 "}New message for ${client.name}: ${who} (${phone})${lead.reason ? ` — ${lead.reason}` : ""}${lead.serviceAddress ? ` · at ${lead.serviceAddress}` : ""}`;
    const r = await notifier.sendSms({ to: sms, body });
    await logNotification(client.id, "lead", "sms", sms, { body, leadId: lead.id }, r);
  }
  for (const email of emails) {
    const subject = urgent ? `🚨 URGENT — ${who} needs a call back` : `New message — ${who}`;
    const r = await notifier.sendEmail({
      to: email,
      subject,
      html: ownerEmailHtml({
        title: urgent ? "🚨 Emergency message" : "📨 New message",
        business: client.name,
        lines: [
          `<strong>${esc(who)}</strong>${lead.phone ? ` · ${phone}` : ""}`,
          lead.reason ? `Reason: ${esc(lead.reason)}` : "",
          lead.serviceAddress ? `Address: ${esc(lead.serviceAddress)}` : "",
          lead.message ? `&ldquo;${esc(lead.message)}&rdquo;` : "",
        ].filter(Boolean),
      }),
      text: `New message for ${client.name}: ${who} (${phone})${lead.reason ? ` — ${lead.reason}` : ""}${lead.serviceAddress ? `\nAddress: ${lead.serviceAddress}` : ""}${lead.message ? `\n"${lead.message}"` : ""}`,
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
export const CALL_PROBLEM_KIND = "call_problem";

/**
 * A call-problem alert is worth sending only while a callback can still save
 * it. A webhook replayed or reprocessed hours later must not text the owner
 * about a call they can no longer act on as "now".
 */
export const CALL_PROBLEM_MAX_AGE_MS = 2 * 60 * 60 * 1000;

type CallProblemTarget = { channel: "email" | "sms"; recipient: string; payload: Record<string, unknown> };

/**
 * Claim the call's problem alert: one queued notification per target, or null
 * if this call already has one. Retell sends `call_ended` and then
 * `call_analyzed` about a second apart and both run the health check, so
 * without this claim every stranded caller was alerted twice (Nov 10, 2026).
 * The advisory lock serialises the two webhook invocations; rows written
 * before `kind` existed (payload has callId but no kind) still count.
 */
async function claimCallProblemAlert(
  clientId: string,
  callId: string,
  targets: CallProblemTarget[],
): Promise<{ id: string; channel: "email" | "sms"; recipient: string; payload: unknown }[] | null> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`call-problem:${callId}`}))`);
    const existing = await tx
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.clientId, clientId),
          eq(notifications.type, "system"),
          sql`${notifications.payload}->>'callId' = ${callId}`,
          sql`coalesce(${notifications.payload}->>'kind', ${CALL_PROBLEM_KIND}) = ${CALL_PROBLEM_KIND}`,
          ne(notifications.status, "failed"),
        ),
      )
      .limit(1);
    if (existing.length > 0) return null;
    return tx
      .insert(notifications)
      .values(
        targets.map((t) => ({
          clientId,
          type: "system" as const,
          channel: t.channel,
          recipient: t.recipient,
          payload: t.payload,
          status: "queued" as const,
        })),
      )
      .returning({
        id: notifications.id,
        channel: notifications.channel,
        recipient: notifications.recipient,
        payload: notifications.payload,
      });
  });
}

export type CallProblemResult =
  | { status: "not_a_problem" | "stale" | "no_recipient" | "duplicate" }
  | { status: "sent"; email: number; sms: number; failed: number };

export async function notifyOwnerCallProblem(
  client: Client,
  call: { id: string; fromNumber: string | null; startAt: Date | null },
  health: { problems: string[]; notes: string[] },
  now: Date = new Date(),
): Promise<CallProblemResult> {
  const urgent = health.problems.includes("possible_emergency");
  // "Didn't get a person" has three shapes and they're all the same phone call
  // from the caller's side: nobody picked up, a voicemail box picked up, or the
  // line died the instant it connected. Alerting on only the first one meant
  // the two worst-looking failures went out silently.
  const stranded =
    health.problems.includes("stranded_asking_for_human") ||
    health.problems.includes("transferred_to_voicemail") ||
    health.problems.includes("transfer_dropped");
  if (!urgent && !stranded) return { status: "not_a_problem" };

  if (call.startAt && now.getTime() - call.startAt.getTime() > CALL_PROBLEM_MAX_AGE_MS) {
    logger.warn("notify.call_problem.stale", {
      clientId: client.id,
      callId: call.id,
      ageMin: Math.round((now.getTime() - call.startAt.getTime()) / 60000),
    });
    return { status: "stale" };
  }

  const phone = formatPhone(call.fromNumber);
  const when = formatDateTimeWithZone(call.startAt, client.timezone);
  const headline = urgent
    ? `A caller may have had an emergency`
    : `A caller asked for a person and didn't get one`;
  const action = urgent
    ? "Listen to this one first, then call them back."
    : "They're deciding whether to try someone else. A callback now usually saves it.";
  const link = `${env.APP_URL.replace(/\/$/, "")}/portal/calls/${call.id}`;

  const { emails, phones } = await getAlertRecipients(client);
  const smsTargets = client.smsAlertsEnabled ? phones : [];

  const smsBody = `${urgent ? "🚨" : "⚠️"} ${client.name}: ${headline}. ${phone} at ${when}. ${action} ${link}`;
  const subject = `${urgent ? "Urgent — " : ""}${headline} · ${client.name}`;
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
  const text = `${headline}. ${health.notes.join(" ")} Caller ${phone} at ${when}. ${action} ${link}`;

  const targets: CallProblemTarget[] = [
    ...smsTargets.map((recipient) => ({
      channel: "sms" as const,
      recipient,
      payload: { kind: CALL_PROBLEM_KIND, body: smsBody, callId: call.id },
    })),
    ...emails.map((recipient) => ({
      channel: "email" as const,
      recipient,
      payload: { kind: CALL_PROBLEM_KIND, headline, callId: call.id },
    })),
  ];
  if (!targets.length) return { status: "no_recipient" };

  const claimed = await claimCallProblemAlert(client.id, call.id, targets);
  if (!claimed) {
    logger.info("notify.call_problem.duplicate", { clientId: client.id, callId: call.id });
    return { status: "duplicate" };
  }

  let email = 0;
  let sms = 0;
  let failed = 0;
  for (const row of claimed) {
    const r =
      row.channel === "sms"
        ? await notifier.sendSms({ to: row.recipient, body: smsBody })
        : await notifier.sendEmail({ to: row.recipient, subject, html, text });
    // Skipped (channel not configured) stays "queued", like every owner alert.
    const status = r.skipped ? "queued" : r.ok ? "sent" : "failed";
    if (r.ok) {
      if (row.channel === "sms") sms++;
      else email++;
    } else if (!r.skipped) failed++;
    await db
      .update(notifications)
      .set({ status, sentAt: r.ok ? new Date() : null })
      .where(eq(notifications.id, row.id));
  }

  logger.info("notify.call_problem", {
    clientId: client.id,
    callId: call.id,
    problems: health.problems,
    email,
    sms,
    failed,
  });
  return { status: "sent", email, sms, failed };
}
