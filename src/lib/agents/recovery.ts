import "server-only";
import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  agentRuns,
  appointments,
  clients,
  leads,
  reminders,
  type Client,
  type Lead,
} from "@/db/schema";
import { createReminder } from "@/lib/data/reminders";
import { notifier } from "@/lib/notifier";
import { logger } from "@/lib/logger";

/**
 * Agent #5 — outbound recovery. Goal: recover missed revenue. A daily loop
 * finds unbooked leads going cold and recent no-shows, decides who to contact,
 * sends a follow-up SMS, and logs every touch. The manual Text button becomes a
 * standing campaign.
 *
 * Guardrails (a live business's reputation rides on these):
 *  - OPT-IN per client (portal settings); off by default
 *  - max 2 recovery touches per lead, ≥3 days apart; won/lost leads never contacted
 *  - no-shows get exactly one nudge, within 14 days of the missed appointment
 *  - sends only during the client's local daytime (9:00–19:00)
 *  - per-client daily cap; demo-safe (no Twilio → logged, not sent)
 *  - UNATTENDED SENDS ARE TEMPLATED, never LLM text. Call transcripts are
 *    attacker-controlled input; an LLM draft derived from them must pass a
 *    human eye (the portal "Send text" button) before it leaves on the
 *    business's number. Personalization here comes only from short, sanitized
 *    structured fields.
 *  - reply handling stays human: owners mark won/lost, which stops the loop
 */

const MAX_TOUCHES_PER_LEAD = 2;
const MIN_DAYS_BETWEEN_TOUCHES = 3;
const LEAD_MAX_AGE_DAYS = 30;
const NOSHOW_MAX_AGE_DAYS = 14;
const MAX_SENDS_PER_CLIENT = 10;

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

/** Structured fields are stored from calls, so treat them as untrusted too:
 *  collapse whitespace and cap length before they enter a template. */
function sanitizeField(value: string | null | undefined, max = 60): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

interface Touch {
  kind: "lead" | "no_show";
  to: string;
  body: string;
  leadId?: string;
  appointmentId?: string;
}

async function recoverableLeads(client: Client): Promise<Lead[]> {
  const cutoff = new Date(Date.now() - LEAD_MAX_AGE_DAYS * 86400_000);
  const candidates = await db.query.leads.findMany({
    where: and(
      eq(leads.clientId, client.id),
      inArray(leads.status, ["new", "contacted"]),
      gte(leads.createdAt, cutoff),
      isNull(leads.deletedAt),
    ),
    orderBy: [desc(leads.createdAt)],
    limit: 50,
  });

  const out: Lead[] = [];
  for (const lead of candidates) {
    if (!lead.phone?.trim()) continue;
    const touches = await db.query.reminders.findMany({
      where: and(eq(reminders.clientId, client.id), eq(reminders.leadId, lead.id)),
      orderBy: [desc(reminders.createdAt)],
    });
    if (touches.length >= MAX_TOUCHES_PER_LEAD) continue;
    const lastTouch = touches[0]?.createdAt ?? lead.createdAt;
    const idleDays = (Date.now() - lastTouch.getTime()) / 86400_000;
    if (idleDays < MIN_DAYS_BETWEEN_TOUCHES) continue;
    out.push(lead);
  }
  return out;
}

export interface RecoveryResult {
  clientId: string;
  clientName: string;
  sent: number;
  skipped?: string;
}

/** Run recovery for one client. */
export async function recoverClient(client: Client): Promise<RecoveryResult> {
  const base: RecoveryResult = { clientId: client.id, clientName: client.name, sent: 0 };

  const hour = localHour(client.timezone);
  if (hour < 9 || hour >= 19) return { ...base, skipped: "outside_daytime" };

  const business = client.name;
  const callback = client.escalationNumber?.trim();
  const signature = callback ? ` You can reach us at ${callback}.` : "";

  const touches: Touch[] = [];

  // Cold unbooked leads — templated body, personalized only by short sanitized fields.
  for (const lead of await recoverableLeads(client)) {
    const name = sanitizeField(lead.name, 40);
    const about = sanitizeField(lead.service || lead.reason, 60) || "your request";
    const body =
      `Hi${name ? ` ${name}` : ""}, it's ${business} — following up on your call about ${about}. Still happy to help; want to get you booked in?` +
      signature;
    touches.push({ kind: "lead", to: lead.phone!.trim(), body, leadId: lead.id });
    if (touches.length >= MAX_SENDS_PER_CLIENT) break;
  }

  // Recent no-shows (one nudge each).
  if (touches.length < MAX_SENDS_PER_CLIENT) {
    const cutoff = new Date(Date.now() - NOSHOW_MAX_AGE_DAYS * 86400_000);
    const noShows = await db.query.appointments.findMany({
      where: and(
        eq(appointments.clientId, client.id),
        eq(appointments.status, "no_show"),
        gte(appointments.startAt, cutoff),
        isNull(appointments.deletedAt),
      ),
      limit: 25,
    });
    for (const appt of noShows) {
      if (!appt.customerPhone?.trim()) continue;
      const nudged = await db.query.reminders.findFirst({
        where: and(
          eq(reminders.clientId, client.id),
          eq(reminders.appointmentId, appt.id),
          gte(reminders.createdAt, appt.startAt),
        ),
      });
      if (nudged) continue;
      const customer = sanitizeField(appt.customerName, 40);
      touches.push({
        kind: "no_show",
        to: appt.customerPhone.trim(),
        body:
          `Hi${customer ? ` ${customer}` : ""}, we missed you at ${business}! No worries — want to pick a new time?` +
          signature,
        appointmentId: appt.id,
      });
      if (touches.length >= MAX_SENDS_PER_CLIENT) break;
    }
  }

  if (touches.length === 0) return { ...base, skipped: "nothing_to_recover" };

  const [run] = await db
    .insert(agentRuns)
    .values({ clientId: client.id, kind: "outbound_recovery" })
    .returning();

  let sent = 0;
  try {
    for (const t of touches) {
      const result = await notifier.sendSms({ to: t.to, body: t.body });
      const failed = !result.ok && !result.skipped;
      await createReminder(client.id, {
        leadId: t.leadId ?? null,
        appointmentId: t.appointmentId ?? null,
        channel: "sms",
        status: failed ? "failed" : "sent",
        sentAt: failed ? null : new Date(),
        error: failed ? (result.error ?? "Send failed") : null,
      });
      if (!failed) {
        sent += 1;
        if (t.leadId) {
          await db
            .update(leads)
            .set({ status: "contacted" })
            .where(and(eq(leads.id, t.leadId), eq(leads.clientId, client.id), eq(leads.status, "new")));
        }
      }
    }
    if (run) {
      await db
        .update(agentRuns)
        .set({
          status: "succeeded",
          finishedAt: new Date(),
          stats: { attempted: touches.length, sent },
        })
        .where(eq(agentRuns.id, run.id));
    }
    return { ...base, sent };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (run) {
      await db
        .update(agentRuns)
        .set({ status: "failed", finishedAt: new Date(), error: message })
        .where(eq(agentRuns.id, run.id));
    }
    logger.error("agents.recovery.failed", { clientId: client.id, error: message });
    return { ...base, sent, skipped: `error: ${message}` };
  }
}

/** Daily entry point: run recovery for every live client that OPTED IN via
 *  portal settings. (Trial clients and non-consenting clients are excluded —
 *  outbound to real customers is opt-in only.) */
export async function runOutboundRecovery(budgetMs = 240_000): Promise<RecoveryResult[]> {
  const deadline = Date.now() + budgetMs;
  const active = await db.query.clients.findMany({
    where: and(
      eq(clients.status, "live"),
      eq(clients.outboundRecoveryEnabled, true),
      isNull(clients.deletedAt),
    ),
  });
  const results: RecoveryResult[] = [];
  for (const client of active) {
    if (Date.now() > deadline) {
      results.push({ clientId: client.id, clientName: client.name, sent: 0, skipped: "time_budget" });
      continue;
    }
    results.push(await recoverClient(client));
  }
  return results;
}
