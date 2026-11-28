import "server-only";
import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { calls, clients, subscriptions } from "@/db/schema";
import { PLANS, type PlanKey } from "@/config/plans";
import { notifier } from "@/lib/notifier";
import { env, integrations } from "@/lib/env";
import { logger } from "@/lib/logger";
import { periodStart } from "@/lib/minutes";
import { questionsLine, questionsLineHtml } from "@/lib/lifecycle";
import {
  adminCapLine,
  countedSeconds,
  minuteCapDecision,
  nextMinuteCapFlags,
  renderOwnerCapEmail,
  usedMinutesFromSeconds,
  type MinuteCapFlags,
} from "@/lib/minute-cap";

/** Minutes counted toward the cap this billing period (spam and blocked callers excluded). */
export async function countedMinutesSince(clientId: string, since: Date, blockedNumbers: string[]): Promise<number> {
  const rows = await db
    .select({ durationSec: calls.durationSec, outcome: calls.outcome, fromNumber: calls.fromNumber })
    .from(calls)
    .where(and(eq(calls.clientId, clientId), gte(calls.startAt, since)));
  return usedMinutesFromSeconds(countedSeconds(rows, blockedNumbers));
}

export interface AdminCapFlag {
  clientId: string;
  line: string;
  periodStart: Date;
}

/** Write just the minuteCap key, so a concurrent setup_flags edit isn't overwritten. */
async function saveFlags(clientId: string, flags: MinuteCapFlags): Promise<void> {
  await db
    .update(clients)
    .set({
      setupFlags: sql`jsonb_set(coalesce(${clients.setupFlags}, '{}'::jsonb), '{minuteCap}', ${JSON.stringify(flags)}::jsonb)`,
    })
    .where(eq(clients.id, clientId));
}

/**
 * Daily (rides the health-check cron). Emails each owner who is past their
 * plan's minutes plus the grace, once per billing period, and returns the
 * operator flags for this morning's health email. Never touches a call.
 * Fail-soft per business: one bad row never stops the rest, or the health check.
 */
export async function runMinuteCapAlerts(now = new Date()): Promise<{ ownersEmailed: number; adminFlags: AdminCapFlag[] }> {
  const capped = (Object.keys(PLANS) as PlanKey[]).filter((k) => PLANS[k].includedMinutes !== null);
  const rows = await db
    .select({
      id: clients.id,
      name: clients.name,
      ownerEmail: clients.ownerEmail,
      setupFlags: clients.setupFlags,
      plan: subscriptions.plan,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
    })
    .from(clients)
    .innerJoin(subscriptions, eq(subscriptions.clientId, clients.id))
    .where(
      and(
        isNull(clients.deletedAt),
        isNull(subscriptions.deletedAt),
        inArray(subscriptions.status, ["active", "past_due"]),
        inArray(subscriptions.plan, capped),
      ),
    );

  const appUrl = env.APP_URL.replace(/\/$/, "");
  let ownersEmailed = 0;
  const adminFlags: AdminCapFlag[] = [];
  for (const c of rows) {
    if (c.setupFlags?.comped) continue;
    try {
      const plan = c.plan as PlanKey;
      const start = periodStart(c.currentPeriodEnd, now);
      const used = await countedMinutesSince(c.id, start, c.setupFlags?.blockedNumbers ?? []);
      const flags = c.setupFlags?.minuteCap;
      const d = minuteCapDecision({ plan, usedMinutes: used, periodStart: start, flags });
      if (!d.over) continue;

      const marks: { ownerWarnedAt?: string } = {};
      const to = c.ownerEmail?.trim();
      if (d.sendOwner && to && integrations.resend()) {
        const help = `${appUrl}/portal/settings/help`;
        const email = renderOwnerCapEmail({
          businessName: c.name,
          plan,
          usedMinutes: used,
          periodStart: start,
          periodEnd: c.currentPeriodEnd,
          plansUrl: `${appUrl}/portal/settings/billing`,
          questionsText: questionsLine(help),
          questionsHtml: questionsLineHtml(help),
        });
        const sent = await notifier.sendEmail({ to, ...email });
        if (sent.ok) {
          marks.ownerWarnedAt = now.toISOString();
          ownersEmailed += 1;
        }
      }
      if (marks.ownerWarnedAt) await saveFlags(c.id, nextMinuteCapFlags(flags, start, marks));
      if (d.flagAdmin) {
        adminFlags.push({
          clientId: c.id,
          periodStart: start,
          line: adminCapLine({ businessName: c.name, plan, usedMinutes: used, ownerEmailed: Boolean(marks.ownerWarnedAt || (flags?.period === start.toISOString() && flags.ownerWarnedAt)) }),
        });
      }
      logger.info("minute_cap.over", { clientId: c.id, plan, used, threshold: d.threshold, ownerEmailed: Boolean(marks.ownerWarnedAt) });
    } catch (err) {
      logger.warn("minute_cap.check_failed", { clientId: c.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { ownersEmailed, adminFlags };
}

/** After the health email went out: don't flag these again this billing period. */
export async function markAdminFlagged(flags: AdminCapFlag[], now = new Date()): Promise<void> {
  for (const f of flags) {
    try {
      const [row] = await db.select({ setupFlags: clients.setupFlags }).from(clients).where(eq(clients.id, f.clientId)).limit(1);
      await saveFlags(f.clientId, nextMinuteCapFlags(row?.setupFlags?.minuteCap, f.periodStart, { adminFlaggedAt: now.toISOString() }));
    } catch (err) {
      logger.warn("minute_cap.mark_failed", { clientId: f.clientId, error: err instanceof Error ? err.message : String(err) });
    }
  }
}
