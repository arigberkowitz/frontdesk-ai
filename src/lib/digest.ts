import "server-only";
import { and, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { clients, notifications, type Client } from "@/db/schema";
import { getClientPeriodSummary, type PeriodSummary } from "./data/metrics";
import { notifier } from "./notifier";
import { formatCurrencyCents } from "./format";
import { env } from "./env";
import { logger } from "./logger";

export type DigestPeriod = "daily" | "weekly";

/**
 * Owner digest per client (§E3): a short SMS of what the AI caught over the
 * period, logged to `notifications` (§E4). Clients with no activity are skipped
 * to avoid noise. Owner email digests follow once we capture an owner email.
 */
export async function sendDigests(
  period: DigestPeriod,
): Promise<{ clients: number; sent: number; skipped: number }> {
  const sinceDays = period === "daily" ? 1 : 7;
  const label = period === "daily" ? "today" : "this week";

  const active = await db.query.clients.findMany({
    where: and(inArray(clients.status, ["live", "trial"]), isNull(clients.deletedAt)),
  });

  let sent = 0;
  let skipped = 0;

  for (const client of active) {
    const s = await getClientPeriodSummary(client.id, sinceDays);
    if (s.calls === 0 && s.bookings === 0 && s.leads === 0) {
      skipped++;
      continue;
    }
    const to = client.escalationNumber?.trim();
    if (!to) {
      skipped++;
      continue;
    }

    const body = `📊 ${client.name} — ${label}: ${s.calls} calls answered, ${s.bookings} booked, ${s.leads} leads, ${s.afterHours} after-hours saves. Est. revenue captured: ${formatCurrencyCents(
      s.estRevenueCents,
    )}.`;
    const result = await notifier.sendSms({ to, body });
    await db.insert(notifications).values({
      clientId: client.id,
      type: period === "daily" ? "digest_daily" : "digest_weekly",
      channel: "sms",
      recipient: to,
      payload: { body, summary: s },
      status: result.skipped ? "queued" : result.ok ? "sent" : "failed",
      sentAt: result.ok ? new Date() : null,
    });
    if (result.ok) sent++;
    else skipped++;
  }

  logger.info("digest.run", { period, clients: active.length, sent, skipped });
  return { clients: active.length, sent, skipped };
}

/* --------------------------- weekly owner report -------------------------- */

function esc(s: string): string {
  return s.replace(/[<>&]/g, (c) => (c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"));
}

function statRow(label: string, value: string, sub?: string): string {
  return `<tr>
    <td style="padding:10px 0;border-bottom:1px solid #eee;color:#555;font-size:14px">${label}${
      sub ? `<br><span style="color:#999;font-size:12px">${sub}</span>` : ""
    }</td>
    <td style="padding:10px 0;border-bottom:1px solid #eee;text-align:right;font-size:20px;font-weight:600;color:#111">${value}</td>
  </tr>`;
}

/** The retention machine: one glance says what the AI earned this week. */
export function weeklyReportEmailHtml(client: Client, s: PeriodSummary): string {
  const revenue = formatCurrencyCents(s.estRevenueCents);
  return `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto">
  <p style="color:#666;margin:0 0 4px;font-size:13px">Your week with FrontDesk AI</p>
  <h1 style="margin:0 0 6px;font-size:22px">${esc(client.name)}</h1>
  <p style="margin:0 0 18px;font-size:15px;color:#333">
    Your AI receptionist answered <strong>${s.calls} call${s.calls === 1 ? "" : "s"}</strong>,
    booked <strong>${revenue}</strong> in appointments, and saved
    <strong>${s.afterHours} after-hours call${s.afterHours === 1 ? "" : "s"}</strong> this week.
  </p>
  <table style="width:100%;border-collapse:collapse">
    ${statRow("Calls answered", String(s.calls), "Every one picked up on the first ring")}
    ${statRow("Appointments booked", String(s.bookings), `Est. revenue captured: ${revenue}`)}
    ${statRow("After-hours saves", String(s.afterHours), "Calls that would have gone to voicemail")}
    ${statRow("Messages & leads captured", String(s.leads), "Callers who left a callback request")}
  </table>
  <p style="margin:20px 0">
    <a href="${env.APP_URL}/portal" style="background:#111;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;display:inline-block">Open your dashboard</a>
  </p>
  <p style="color:#999;font-size:12px;margin-top:18px">Sent every week by FrontDesk AI · numbers cover the last 7 days</p>
</div>`;
}

/**
 * Weekly owner report email — sent alongside the weekly SMS digest to each
 * live/trial client's owner email. Quiet weeks (zero activity) are skipped.
 */
export async function sendWeeklyReports(): Promise<{ clients: number; sent: number; skipped: number }> {
  const active = await db.query.clients.findMany({
    where: and(inArray(clients.status, ["live", "trial"]), isNull(clients.deletedAt)),
  });

  let sent = 0;
  let skipped = 0;

  for (const client of active) {
    const to = client.ownerEmail?.trim();
    if (!to) {
      skipped++;
      continue;
    }
    const s = await getClientPeriodSummary(client.id, 7);
    if (s.calls === 0 && s.bookings === 0 && s.leads === 0) {
      skipped++;
      continue;
    }

    const subject = `Your AI answered ${s.calls} call${s.calls === 1 ? "" : "s"} and booked ${formatCurrencyCents(s.estRevenueCents)} this week`;
    const html = weeklyReportEmailHtml(client, s);
    const result = await notifier.sendEmail({
      to,
      subject,
      html,
      text: `${client.name} — this week: ${s.calls} calls answered, ${s.bookings} booked (${formatCurrencyCents(s.estRevenueCents)} est. revenue), ${s.leads} leads, ${s.afterHours} after-hours saves. See ${env.APP_URL}/portal`,
    });
    await db.insert(notifications).values({
      clientId: client.id,
      type: "digest_weekly",
      channel: "email",
      recipient: to,
      payload: { subject, summary: s },
      status: result.skipped ? "queued" : result.ok ? "sent" : "failed",
      sentAt: result.ok ? new Date() : null,
    });
    if (result.ok) sent++;
    else skipped++;
  }

  logger.info("digest.weekly_report", { clients: active.length, sent, skipped });
  return { clients: active.length, sent, skipped };
}
