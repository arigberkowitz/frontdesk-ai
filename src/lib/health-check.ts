import "server-only";
import { and, eq, gte, inArray, isNotNull, lte, ne } from "drizzle-orm";
import { db } from "@/db";
import { calls, clients, reminders, webhookEvents } from "@/db/schema";
import { analyzeCall, type CallProblem } from "@/lib/call-health";
import { env } from "@/lib/env";
import { notifier } from "@/lib/notifier";
import { logger } from "@/lib/logger";

/**
 * The operator health check: one email, only when something is wrong.
 *
 * This exists because both real production failures so far were SILENT.
 * Twilio rejected the credentials and every text failed for days — the only
 * trace was "Authenticate" in a database column nobody was reading. Then a
 * trial expired with nobody watching. Neither broke a page, threw to a log
 * anyone tails, or told the one person who could fix it.
 *
 * So this job reads the same tables the failures hide in — failed texts,
 * stuck webhooks, unhealthy calls, dying trials — and emails the operator a
 * short plain-English list. A morning with nothing wrong sends nothing
 * (except a Monday one-liner, so silence stays distinguishable from a cron
 * that quietly stopped running).
 */

export interface HealthIssue {
  severity: "critical" | "warning";
  /** One plain-English sentence. No codes, no table names. */
  line: string;
}

/** How far back each run looks. Daily cron + 25h window = no gaps. */
const WINDOW_HOURS = 25;
/** A webhook still unprocessed after this long is stuck, not in-flight. */
const WEBHOOK_GRACE_MIN = 15;
/** Trials get flagged this many days before they lapse. */
const TRIAL_WARN_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/* ------------------------------ pure logic ------------------------------ */
/* Everything below takes plain rows and returns issues — tested directly.  */

export interface FailedTextRow {
  clientName: string;
  error: string | null;
}

export function issuesFromFailedTexts(rows: FailedTextRow[]): HealthIssue[] {
  if (rows.length === 0) return [];
  const issues: HealthIssue[] = [];

  // Credential rejection fails EVERY send for EVERY business — it's the
  // platform-down case, and it's the exact failure that went unseen for days.
  const credentialFailure = rows.some(
    (r) => r.error != null && (/\b20003\b/.test(r.error) || /authenticate/i.test(r.error)),
  );
  if (credentialFailure) {
    issues.push({
      severity: "critical",
      line: "Texting credentials are being REJECTED — every text from every business is failing. Re-check the three Twilio values in Vercel and redeploy.",
    });
  }

  const byClient = new Map<string, number>();
  for (const r of rows) byClient.set(r.clientName, (byClient.get(r.clientName) ?? 0) + 1);
  for (const [name, count] of byClient) {
    issues.push({
      severity: credentialFailure ? "warning" : "critical",
      line: `${name}: ${count} text${count === 1 ? "" : "s"} failed to send in the last day. The Leads and Appointments pages show who was missed.`,
    });
  }
  return issues;
}

export interface StuckWebhookRow {
  source: string;
  eventType: string;
  status: string;
}

export function issuesFromWebhooks(rows: StuckWebhookRow[]): HealthIssue[] {
  if (rows.length === 0) return [];
  const bySource = new Map<string, number>();
  for (const r of rows) bySource.set(r.source, (bySource.get(r.source) ?? 0) + 1);
  return [...bySource].map(([source, count]) => ({
    severity: "critical" as const,
    line:
      source === "stripe"
        ? `${count} Stripe event${count === 1 ? "" : "s"} failed to process — a payment may have happened without the account updating. Check the Stripe dashboard's webhook deliveries.`
        : `${count} ${source} event${count === 1 ? "" : "s"} failed to process — call records may be missing or stale for those calls.`,
  }));
}

export interface TrialClientRow {
  name: string;
  trialEndsAt: Date | null;
}

export function issuesFromTrials(rows: TrialClientRow[], now: Date): HealthIssue[] {
  const issues: HealthIssue[] = [];
  for (const c of rows) {
    if (!c.trialEndsAt) continue;
    const msLeft = c.trialEndsAt.getTime() - now.getTime();
    if (msLeft <= 0) {
      issues.push({
        severity: "critical",
        line: `${c.name}'s free trial has EXPIRED. Their receptionist still answers, but they can't activate — put them on the house or send them to checkout today.`,
      });
    } else if (msLeft <= TRIAL_WARN_DAYS * DAY_MS) {
      const days = Math.ceil(msLeft / DAY_MS);
      issues.push({
        severity: "warning",
        line: `${c.name}'s free trial ends in ${days} day${days === 1 ? "" : "s"}. Decide now: comp them or ask them to pick a plan.`,
      });
    }
  }
  return issues;
}

/** The call problems worth waking the operator for, and how to say them. */
const SERIOUS_CALL_PROBLEMS: Partial<Record<CallProblem, string>> = {
  transfer_dropped: "a transfer that dropped",
  transferred_to_voicemail: "a transfer that reached voicemail instead of a person",
  stranded_asking_for_human: "a caller stranded asking for a person",
  possible_emergency: "a possible emergency on the line",
};

export interface CallRow {
  clientName: string;
  transcript: string | null;
  durationSec: number | null;
  outcome: string | null;
}

export function issuesFromCalls(rows: CallRow[]): HealthIssue[] {
  const byClient = new Map<string, Map<CallProblem, number>>();
  for (const row of rows) {
    const health = analyzeCall({
      transcript: row.transcript,
      durationSec: row.durationSec,
      outcome: row.outcome,
    });
    for (const problem of health.problems) {
      if (!(problem in SERIOUS_CALL_PROBLEMS)) continue;
      const counts = byClient.get(row.clientName) ?? new Map<CallProblem, number>();
      counts.set(problem, (counts.get(problem) ?? 0) + 1);
      byClient.set(row.clientName, counts);
    }
  }
  return [...byClient].map(([name, counts]) => {
    const parts = [...counts].map(([problem, n]) =>
      n === 1 ? SERIOUS_CALL_PROBLEMS[problem]! : `${n}× ${SERIOUS_CALL_PROBLEMS[problem]}`,
    );
    return {
      severity: "critical" as const,
      line: `${name} had ${parts.join(", ")} in the last day. Listen to the recordings on the Calls page.`,
    };
  });
}

export function renderHealthEmail(
  issues: HealthIssue[],
  opts: { now: Date; appUrl: string },
): { subject: string; text: string } {
  const critical = issues.filter((i) => i.severity === "critical");
  const warnings = issues.filter((i) => i.severity === "warning");
  const subject =
    critical.length > 0
      ? `FrontDesk AI needs you: ${critical.length} problem${critical.length === 1 ? "" : "s"} found`
      : `FrontDesk AI heads-up: ${warnings.length} thing${warnings.length === 1 ? "" : "s"} to watch`;
  const lines: string[] = [];
  if (critical.length > 0) {
    lines.push("NEEDS FIXING TODAY:");
    for (const i of critical) lines.push(`  • ${i.line}`);
  }
  if (warnings.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("Worth a look:");
    for (const i of warnings) lines.push(`  • ${i.line}`);
  }
  lines.push("");
  lines.push(`Dashboard: ${opts.appUrl}/dashboard`);
  lines.push(
    `— automated morning health check, ${opts.now.toISOString().slice(0, 10)}. You only get this email when something needs attention (plus a Monday all-clear).`,
  );
  return { subject, text: lines.join("\n") };
}

/* ------------------------------ the sweep ------------------------------- */

export interface HealthCheckResult {
  issues: HealthIssue[];
  emailed: boolean;
  emailError?: string;
}

export async function runHealthCheck(now = new Date()): Promise<HealthCheckResult> {
  const since = new Date(now.getTime() - WINDOW_HOURS * 60 * 60 * 1000);
  const webhookCutoff = new Date(now.getTime() - WEBHOOK_GRACE_MIN * 60 * 1000);

  const [failedTexts, stuckWebhooks, trialClients, recentCalls] = await Promise.all([
    db
      .select({ clientName: clients.name, error: reminders.error })
      .from(reminders)
      .innerJoin(clients, eq(clients.id, reminders.clientId))
      .where(and(eq(reminders.status, "failed"), gte(reminders.createdAt, since))),
    db
      .select({
        source: webhookEvents.source,
        eventType: webhookEvents.eventType,
        status: webhookEvents.status,
      })
      .from(webhookEvents)
      .where(
        and(
          gte(webhookEvents.createdAt, since),
          lte(webhookEvents.createdAt, webhookCutoff),
          ne(webhookEvents.status, "processed"),
          ne(webhookEvents.status, "ignored"),
        ),
      ),
    db
      .select({ name: clients.name, trialEndsAt: clients.trialEndsAt })
      .from(clients)
      .where(and(eq(clients.status, "trial"), isNotNull(clients.trialEndsAt))),
    db
      .select({
        clientName: clients.name,
        transcript: calls.transcript,
        durationSec: calls.durationSec,
        outcome: calls.outcome,
      })
      .from(calls)
      .innerJoin(clients, eq(clients.id, calls.clientId))
      .where(
        and(gte(calls.createdAt, since), inArray(clients.status, ["trial", "live"])),
      ),
  ]);

  const issues: HealthIssue[] = [
    ...issuesFromFailedTexts(failedTexts),
    ...issuesFromWebhooks(stuckWebhooks),
    ...issuesFromTrials(trialClients, now),
    ...issuesFromCalls(recentCalls),
  ];

  // Sunday=0 … Monday=1 in UTC. The Monday all-clear is the proof-of-life:
  // without it, "no email" and "the watcher itself died" look identical.
  const mondayAllClear = issues.length === 0 && now.getUTCDay() === 1;

  let emailed = false;
  let emailError: string | undefined;
  if (issues.length > 0) {
    const { subject, text } = renderHealthEmail(issues, { now, appUrl: env.APP_URL });
    const sent = await notifier.sendEmail({ to: env.ALERT_EMAIL, subject, text });
    emailed = sent.ok;
    if (!sent.ok && !sent.skipped) emailError = sent.error;
  } else if (mondayAllClear) {
    const sent = await notifier.sendEmail({
      to: env.ALERT_EMAIL,
      subject: "FrontDesk AI: all clear",
      text: `Nothing needed your attention this week — texts sending, webhooks processing, calls healthy, no trials expiring.\n\n— automated morning health check, ${now.toISOString().slice(0, 10)}.`,
    });
    emailed = sent.ok;
    if (!sent.ok && !sent.skipped) emailError = sent.error;
  }

  logger.info("health_check.ran", {
    issues: issues.length,
    critical: issues.filter((i) => i.severity === "critical").length,
    emailed,
  });
  return { issues, emailed, ...(emailError ? { emailError } : {}) };
}
