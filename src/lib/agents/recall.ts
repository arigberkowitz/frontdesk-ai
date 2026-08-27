import "server-only";
import { and, desc, eq, gt, gte, inArray, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { agentRuns, appointments, clients, reminders, services, type Client } from "@/db/schema";
import { createReminder } from "@/lib/data/reminders";
import { isOptedOut } from "@/lib/data/sms-optouts";
import {
  RECALL_LEAD_DAYS,
  RECALL_MAX_OVERDUE_DAYS,
  isDueForRecall,
  monthsBetween,
  recallBody,
  type RecallCandidate,
} from "@/lib/recall";
import { notifier } from "@/lib/notifier";
import { logger } from "@/lib/logger";
import { mapLimit, outOfBudget } from "./util";

/**
 * "You're about due" — the loop that fills next month.
 *
 * A dental practice lives on six-month cleanings and a barber on four-week
 * fades. We already record every visit and which service it was; nothing was
 * reading it. This is the highest-revenue thing in the product and also the
 * easiest to get embarrassingly wrong, so the rules are conservative:
 *
 *  - only services the business gave a recall interval; null means one-off
 *  - never anyone who already has a future appointment booked
 *  - a week before due through 60 days overdue, then we stop
 *  - one recall per number per 90 days, whatever they've had done
 *  - daytime, per-client cap, STOP honoured, templated body
 */

const MAX_SENDS_PER_CLIENT = 25;

function localHour(tz: string | null): number {
  try {
    return Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: tz ?? "America/Los_Angeles",
        hour: "numeric",
        hour12: false,
      }).format(new Date()),
    );
  } catch {
    return 12;
  }
}

const digits = (p: string | null | undefined) => (p ?? "").replace(/\D/g, "").slice(-10);

export interface RecallRunResult {
  clientId: string;
  clientName: string;
  sent: number;
  skipped?: string;
}

export async function recallForClient(client: Client, now = new Date()): Promise<RecallRunResult> {
  const base: RecallRunResult = { clientId: client.id, clientName: client.name, sent: 0 };

  const hour = localHour(client.timezone);
  if (hour < 9 || hour >= 19) return { ...base, skipped: "outside_daytime" };

  const recallServices = await db.query.services.findMany({
    where: and(eq(services.clientId, client.id), isNull(services.deletedAt)),
  });
  const intervalByService = new Map(
    recallServices
      .filter((s) => s.recallIntervalDays && s.recallIntervalDays > 0)
      .map((s) => [s.id, { days: s.recallIntervalDays!, name: s.name }]),
  );
  if (intervalByService.size === 0) return { ...base, skipped: "no_recall_services" };

  // The widest window any of this client's services could put someone in.
  const longest = Math.max(...[...intervalByService.values()].map((v) => v.days));
  const oldest = new Date(
    now.getTime() - (longest + RECALL_MAX_OVERDUE_DAYS) * 86_400_000,
  );
  const newest = new Date(now.getTime() + RECALL_LEAD_DAYS * 86_400_000);

  const past = await db.query.appointments.findMany({
    where: and(
      eq(appointments.clientId, client.id),
      inArray(appointments.status, ["booked", "confirmed"]),
      gte(appointments.startAt, oldest),
      lte(appointments.startAt, now),
      isNull(appointments.deletedAt),
    ),
    orderBy: [desc(appointments.startAt)],
    limit: 500,
  });
  if (past.length === 0) return { ...base, skipped: "no_history" };

  // Anyone already on the books is out. One query, not one per customer.
  const upcoming = await db.query.appointments.findMany({
    where: and(
      eq(appointments.clientId, client.id),
      inArray(appointments.status, ["booked", "confirmed"]),
      gt(appointments.startAt, now),
      lte(appointments.startAt, newest),
      isNull(appointments.deletedAt),
    ),
    limit: 500,
  });
  const bookedAhead = new Set(upcoming.map((a) => digits(a.customerPhone)).filter(Boolean));

  const priorRecalls = await db.query.reminders.findMany({
    where: and(
      eq(reminders.clientId, client.id),
      eq(reminders.kind, "recall"),
      inArray(reminders.status, ["queued", "sent"]),
    ),
    orderBy: [desc(reminders.createdAt)],
    limit: 1000,
  });
  const apptById = new Map(past.map((a) => [a.id, a]));
  const lastRecallByPhone = new Map<string, Date>();
  for (const r of priorRecalls) {
    const phone = r.appointmentId ? apptById.get(r.appointmentId)?.customerPhone : null;
    const key = digits(phone);
    if (key && !lastRecallByPhone.has(key)) lastRecallByPhone.set(key, r.createdAt);
  }

  // Only the most recent visit per customer matters — an older one is already
  // superseded, and treating each visit separately would text somebody twice
  // for the same overdue cleaning.
  const latestPerPhone = new Map<string, (typeof past)[number]>();
  for (const a of past) {
    const key = digits(a.customerPhone);
    if (!key) continue;
    if (!latestPerPhone.has(key)) latestPerPhone.set(key, a);
  }

  const due: { appt: (typeof past)[number]; serviceName: string }[] = [];
  for (const [key, appt] of latestPerPhone) {
    const svc = appt.serviceId ? intervalByService.get(appt.serviceId) : undefined;
    const candidate: RecallCandidate = {
      lastVisitAt: appt.endAt ?? appt.startAt,
      recallIntervalDays: svc?.days ?? null,
      status: appt.status,
      customerPhone: appt.customerPhone,
      hasUpcoming: bookedAhead.has(key),
      lastRecalledAt: lastRecallByPhone.get(key) ?? null,
    };
    if (isDueForRecall(candidate, now)) due.push({ appt, serviceName: svc!.name });
  }
  if (due.length === 0) return { ...base, skipped: "nobody_due" };

  const [run] = await db
    .insert(agentRuns)
    .values({ clientId: client.id, kind: "recall" })
    .returning();

  let sent = 0;
  let notSent = 0;
  try {
    for (const { appt, serviceName } of due.slice(0, MAX_SENDS_PER_CLIENT)) {
      const to = appt.customerPhone!.trim();
      if (await isOptedOut(to)) continue;
      const body = recallBody({
        businessName: client.name,
        customerName: appt.customerName,
        serviceName,
        monthsSince: monthsBetween(appt.endAt ?? appt.startAt, now),
        callbackNumber: client.retellPhoneNumber,
      });
      const result = await notifier.sendSms({ to, body });
      if (result.skipped) {
        notSent += 1;
        continue;
      }
      const failed = !result.ok;
      await createReminder(client.id, {
        appointmentId: appt.id,
        leadId: null,
        channel: "sms",
        kind: "recall",
        status: failed ? "failed" : "sent",
        sentAt: failed ? null : new Date(),
        error: failed ? (result.error ?? "Send failed") : null,
      });
      if (!failed) sent += 1;
    }
    if (run) {
      await db
        .update(agentRuns)
        .set({
          status: "succeeded",
          finishedAt: new Date(),
          stats: { attempted: due.length, sent, notSent },
        })
        .where(eq(agentRuns.id, run.id));
    }
    if (notSent > 0) logger.warn("agents.recall.provider_unavailable", { clientId: client.id, notSent });
    return { ...base, sent, ...(notSent > 0 && sent === 0 ? { skipped: "sms_not_configured" } : {}) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (run) {
      await db
        .update(agentRuns)
        .set({ status: "failed", finishedAt: new Date(), error: message })
        .where(eq(agentRuns.id, run.id));
    }
    logger.error("agents.recall.failed", { clientId: client.id, error: message });
    return { ...base, sent, skipped: `error: ${message}` };
  }
}

/** Daily entry point: every live client that turned recall on. */
export async function runRecall(budgetMs = 240_000): Promise<RecallRunResult[]> {
  const deadline = Date.now() + budgetMs;
  const active = await db.query.clients.findMany({
    where: and(eq(clients.status, "live"), eq(clients.recallEnabled, true), isNull(clients.deletedAt)),
  });
  return mapLimit(active, 3, async (client) => {
    const base: RecallRunResult = { clientId: client.id, clientName: client.name, sent: 0 };
    if (outOfBudget(deadline)) return { ...base, skipped: "time_budget" };
    return recallForClient(client);
  });
}
