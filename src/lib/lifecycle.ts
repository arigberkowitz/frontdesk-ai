import "server-only";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { clients, subscriptions } from "@/db/schema";
import { notifier } from "@/lib/notifier";
import { env, integrations } from "@/lib/env";
import { formatPhone, formatCurrencyCents } from "@/lib/format";
import { getClientPeriodSummary } from "@/lib/data/metrics";
import { planList, TRIAL_DAYS } from "@/config/plans";
import { logger } from "@/lib/logger";

/**
 * The three emails between "signed up" and "paid".
 *
 * A signup who closes the tab used to hear nothing from the product until
 * a call happened — and a business that hasn't forwarded its line has no
 * calls, so it heard nothing at all, for three weeks, and then found its
 * trial had ended. Three emails, none of them clever:
 *
 *   welcome   — the moment signup finishes: your number, call it, forward
 *               your line (the actual dial code), where alerts go.
 *   7 days    — what the AI has done so far, and the plans.
 *   1 day     — tomorrow it ends; three days after that the number goes.
 *
 * Dedupe lives in setupFlags.trialEmails — per-client state, no migration.
 */

function esc(s: string): string {
  return s.replace(/[<>&]/g, (c) => (c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"));
}

function shell(title: string, paragraphs: string[]): string {
  return `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;line-height:1.5">
  <h2 style="margin:0 0 14px;font-size:19px">${title}</h2>
  ${paragraphs.map((p) => `<p style="margin:0 0 12px;font-size:15px">${p}</p>`).join("\n  ")}
  <p style="color:#999;font-size:12px;margin-top:20px">Questions? Just reply to this email. · FrontDesk AI</p>
</div>`;
}

function appUrl(path: string): string {
  return `${env.APP_URL.replace(/\/$/, "")}${path}`;
}

function dialCode(number: string): string {
  return `*72 ${formatPhone(number)}`;
}

function plansLine(): string {
  return planList()
    .map((p) => `${p.name} ${formatCurrencyCents(p.monthlyPriceCents)}/mo`)
    .join(" · ");
}

/** Sent once, right after signup — fire-and-forget from the onboarding action. */
export async function sendWelcomeEmail(clientId: string): Promise<void> {
  if (!integrations.resend()) return;
  const c = await db.query.clients.findFirst({
    where: and(eq(clients.id, clientId), isNull(clients.deletedAt)),
    columns: { id: true, name: true, ownerEmail: true, retellPhoneNumber: true, agentName: true, setupFlags: true },
  });
  const to = c?.ownerEmail?.trim();
  if (!c || !to) return;
  if (c.setupFlags?.trialEmails?.welcome) return;

  const agent = c.agentName?.trim() || "Riley";
  const num = c.retellPhoneNumber;
  const subject = num
    ? `${agent} is answering for ${c.name} — call ${formatPhone(num)}`
    : `${agent} is ready for ${c.name}`;

  const paragraphs = num
    ? [
        `Your AI receptionist is live. Its number is <strong>${formatPhone(num)}</strong> — <strong>call it right now</strong> from your cell and ask it something a customer would.`,
        `When you're happy with how it sounds, forward your business line to it: from your business phone, dial <strong>${esc(dialCode(num))}</strong>, wait for the confirmation tone, hang up. (AT&amp;T/T-Mobile: <strong>**21*${num.replace(/[^\d+]/g, "")}#</strong>.) Undo any time with <strong>*73</strong>. Your customers keep calling the number they already know.`,
        `Every booking and message it takes is emailed to <strong>${esc(to)}</strong> the moment it happens — change that, and add a phone for texts, under <a href="${appUrl("/portal/settings")}">Settings</a>.`,
        `Its services, hours and answers are drafted for your industry. <a href="${appUrl("/portal/services")}">Check the prices</a> especially — they're examples until you say otherwise.`,
        `Your free trial runs ${TRIAL_DAYS} days with everything switched on. No card, nothing to set up. We'll check in once near the end.`,
      ]
    : [
        `Your AI receptionist is built and ready to talk to in your browser — <a href="${appUrl("/portal/guidelines")}">try a test call</a>.`,
        `Its own phone number is on the way; if it isn't showing on the Your AI page by tomorrow, press <em>Re-sync</em> there or reply to this email and we'll sort it.`,
        `Its services, hours and answers are drafted for your industry. <a href="${appUrl("/portal/services")}">Check the prices</a> especially — they're examples until you say otherwise.`,
        `Your free trial runs ${TRIAL_DAYS} days with everything switched on. No card, nothing to set up.`,
      ];

  const text = paragraphs.map((p) => p.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&")).join("\n\n");
  const r = await notifier.sendEmail({ to, subject, html: shell(subject, paragraphs), text });
  if (r.ok) {
    await stamp(c.id, c.setupFlags, "welcome");
    logger.info("lifecycle.welcome.sent", { clientId: c.id });
  }
}

async function stamp(
  clientId: string,
  flags: (typeof clients.$inferSelect)["setupFlags"],
  key: "welcome" | "d7" | "d1",
): Promise<void> {
  await db
    .update(clients)
    .set({
      setupFlags: {
        ...(flags ?? {}),
        trialEmails: { ...(flags?.trialEmails ?? {}), [key]: new Date().toISOString() },
      },
    })
    .where(eq(clients.id, clientId));
}

export interface TrialReminderResult {
  sent: number;
  failed: number;
}

const DAY = 24 * 60 * 60 * 1000;

/** Daily. Sends the 7-day and 1-day trial emails to whoever is due one. */
export async function runTrialReminders(now = new Date()): Promise<TrialReminderResult> {
  if (!integrations.resend()) return { sent: 0, failed: 0 };
  const rows = await db
    .select({
      id: clients.id,
      name: clients.name,
      ownerEmail: clients.ownerEmail,
      phone: clients.retellPhoneNumber,
      trialEndsAt: clients.trialEndsAt,
      setupFlags: clients.setupFlags,
    })
    .from(clients)
    .leftJoin(subscriptions, eq(subscriptions.clientId, clients.id))
    .where(
      and(
        isNull(clients.deletedAt),
        eq(clients.status, "trial"),
        isNotNull(clients.trialEndsAt),
        isNotNull(clients.ownerEmail),
        sql`coalesce(${subscriptions.status}::text, '') not in ('active', 'trialing')`,
      ),
    );

  let sent = 0;
  let failed = 0;
  for (const c of rows) {
    if (c.setupFlags?.comped || !c.trialEndsAt || !c.ownerEmail) continue;
    const daysLeft = Math.floor((c.trialEndsAt.getTime() - now.getTime()) / DAY);
    const done = c.setupFlags?.trialEmails ?? {};
    // Windows, not exact days: a cron that ran late or skipped a night still
    // sends once, never twice.
    const key: "d7" | "d1" | null =
      daysLeft <= 1 && daysLeft >= 0 && !done.d1
        ? "d1"
        : daysLeft <= 7 && daysLeft >= 2 && !done.d7
          ? "d7"
          : null;
    if (!key) continue;

    try {
      const s = await getClientPeriodSummary(c.id, TRIAL_DAYS);
      const did =
        s.calls > 0
          ? `So far it has answered <strong>${s.calls} call${s.calls === 1 ? "" : "s"}</strong>` +
            (s.bookings ? `, booked <strong>${s.bookings} appointment${s.bookings === 1 ? "" : "s"}</strong>` : "") +
            (s.leads ? ` and taken <strong>${s.leads} message${s.leads === 1 ? "" : "s"}</strong>` : "") +
            (s.afterHours ? ` — ${s.afterHours} of those after hours, when nobody else would have picked up` : "") +
            `.`
          : c.phone
            ? `It hasn't had a call yet — which usually means the business line isn't forwarded. From your business phone, dial <strong>${esc(dialCode(c.phone))}</strong> and it starts catching the calls you miss.`
            : `It hasn't had a call yet.`;

      const plansUrl = appUrl("/portal/guidelines#plans");
      const subject =
        key === "d7"
          ? `${c.name}: one week left on your free trial`
          : `${c.name}: your free trial ends tomorrow`;
      const paragraphs =
        key === "d7"
          ? [
              `Your free trial has a week to go.`,
              did,
              `To keep it answering after that, <a href="${plansUrl}">pick a plan</a> — ${esc(plansLine())}. Nothing changes until you do; everything you've set up stays.`,
            ]
          : [
              `Your free trial ends tomorrow.`,
              did,
              `<a href="${plansUrl}">Pick a plan</a> and nothing changes — ${esc(plansLine())}.`,
              c.phone
                ? `If you don't, it keeps answering for three more days as a courtesy, then ${formatPhone(c.phone)} is released. If your line is forwarded to it, dial <strong>*73</strong> from that phone first so callers don't reach a dead number.`
                : `If you don't, it switches off three days later. Everything you set up is kept.`,
            ];
      const text = paragraphs.map((p) => p.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&")).join("\n\n");
      const r = await notifier.sendEmail({ to: c.ownerEmail, subject, html: shell(subject, paragraphs), text });
      if (!r.ok) throw new Error(r.error ?? "send failed");
      await stamp(c.id, c.setupFlags, key);
      sent += 1;
      logger.info("lifecycle.trial_reminder.sent", { clientId: c.id, key, daysLeft });
    } catch (err) {
      failed += 1;
      logger.error("lifecycle.trial_reminder.failed", {
        clientId: c.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { sent, failed };
}
