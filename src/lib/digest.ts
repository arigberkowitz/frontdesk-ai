import "server-only";
import { and, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { clients, notifications, type Client } from "@/db/schema";
import { getClientPeriodSummary } from "./data/metrics";
import { getCallHealth } from "./data/calls";
import { notifier } from "./notifier";
import { claimWeeklySummary, finishWeeklySummary, getWeeklyActivity } from "./data/weekly-summary";
import {
  hasWeeklyActivity,
  isoWeekKey,
  weeklySummaryEmail,
  type WeeklySummaryStats,
} from "./weekly-summary-email";
import { formatCurrencyCents } from "./format";
import { env } from "./env";
import { logger } from "./logger";

export type DigestPeriod = "daily" | "weekly";

/**
 * Owner digest per client (§E3): a short SMS of what the AI caught over the
 * period, logged to `notifications` (§E4). Clients with no activity are skipped
 * to avoid noise. Owner email digests follow once we capture an owner email.
 */
export interface DigestRunResult {
  clients: number;
  sent: number;
  skipped: number;
  /** Clients whose send threw. Non-zero means the run was not clean. */
  failed: number;
}

export async function sendDigests(
  period: DigestPeriod,
): Promise<DigestRunResult> {
  const sinceDays = period === "daily" ? 1 : 7;
  const label = period === "daily" ? "today" : "this week";

  const active = await db.query.clients.findMany({
    where: and(inArray(clients.status, ["live", "trial"]), isNull(clients.deletedAt)),
  });

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  // One business's bad data used to throw and abandon the loop, so every client
  // alphabetically after it got nothing — and the run still looked fine from
  // the outside. Each client stands alone now.
  for (const client of active) {
    try {
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

      const body = `📊 ${client.name} — ${label}: ${s.calls} calls answered, ${s.bookings} booked, ${s.leads} leads, ${s.afterHours} after-hours saves. Revenue from appointments held: ${formatCurrencyCents(
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
    } catch (err) {
      failed++;
      logger.error("digest.client_failed", {
        clientId: client.id,
        period,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info("digest.run", { period, clients: active.length, sent, skipped, failed });
  return { clients: active.length, sent, skipped, failed };
}

/* --------------------------- weekly owner report -------------------------- */

export interface WeeklySummaryRunResult extends DigestRunResult {
  /** Businesses that switched the weekly summary off in Settings. */
  optedOut: number;
  /** Businesses already emailed for this ISO week (a retry or overlapping run). */
  alreadySent: number;
  week: string;
}

/** Everything the weekly summary shows for one business, last 7 days. */
export async function getWeeklySummaryStats(clientId: string): Promise<WeeklySummaryStats> {
  const [core, activity] = await Promise.all([
    getClientPeriodSummary(clientId, 7),
    getWeeklyActivity(clientId, 7),
  ]);
  return { ...core, ...activity };
}

/**
 * Render one business's weekly summary email without sending it — used by the
 * portal preview route (Settings → Weekly summary → Preview).
 */
export async function renderWeeklySummaryForClient(
  client: Pick<Client, "id" | "name">,
): Promise<ReturnType<typeof weeklySummaryEmail> & { stats: WeeklySummaryStats }> {
  const stats = await getWeeklySummaryStats(client.id);
  const health = await getCallHealth(client.id, 7).catch(() => null);
  return {
    ...weeklySummaryEmail({
      businessName: client.name,
      stats,
      health: health?.summary,
      baseUrl: env.APP_URL,
    }),
    stats,
  };
}

/**
 * Weekly summary email (Monday cron, /api/cron/weekly-report) to each
 * live/trial business's owner email: calls answered, bookings, cancellations,
 * missed calls won back, new leads and customer texts for the past 7 days.
 *
 *  - Opt-out: `clients.weekly_summary_enabled` (portal Settings → Alerts).
 *  - Dedupe: one `weekly_summary_sends` row per business per ISO week, claimed
 *    BEFORE sending. A retried or overlapping run can't email anyone twice;
 *    only a failed / provider-not-configured week is retried.
 *  - Quiet weeks (nothing at all happened) are skipped, as before.
 */
export async function sendWeeklyReports(now: Date = new Date()): Promise<WeeklySummaryRunResult> {
  const week = isoWeekKey(now);
  const active = await db.query.clients.findMany({
    where: and(inArray(clients.status, ["live", "trial"]), isNull(clients.deletedAt)),
  });

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  let optedOut = 0;
  let alreadySent = 0;

  for (const client of active) {
    try {
      if (client.weeklySummaryEnabled === false) {
        optedOut++;
        continue;
      }
      const to = client.ownerEmail?.trim();
      if (!to) {
        skipped++;
        continue;
      }
      const { stats, subject, html, text } = await renderWeeklySummaryForClient(client);
      if (!hasWeeklyActivity(stats)) {
        skipped++;
        continue;
      }

      const claim = await claimWeeklySummary(client.id, week, to);
      if (!claim) {
        alreadySent++;
        continue;
      }

      const result = await notifier.sendEmail({ to, subject, html, text });
      const status = result.ok ? "sent" : result.skipped ? "skipped" : "failed";
      await finishWeeklySummary(claim, { status, error: result.error ?? null, stats });
      await db.insert(notifications).values({
        clientId: client.id,
        type: "digest_weekly",
        channel: "email",
        recipient: to,
        payload: { subject, week, summary: stats },
        status: result.skipped ? "queued" : result.ok ? "sent" : "failed",
        sentAt: result.ok ? new Date() : null,
      });
      if (result.ok) sent++;
      else if (result.skipped) skipped++;
      else failed++;
    } catch (err) {
      failed++;
      logger.error("digest.weekly_report.client_failed", {
        clientId: client.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info("digest.weekly_report", {
    week,
    clients: active.length,
    sent,
    skipped,
    failed,
    optedOut,
    alreadySent,
  });
  return { clients: active.length, sent, skipped, failed, optedOut, alreadySent, week };
}
