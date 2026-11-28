import "server-only";
import { and, desc, eq, gt, gte, inArray, isNull, ne, notInArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  appointments,
  callInsights,
  calls,
  clients,
  leads,
  notifications,
  services,
  smsMessages,
} from "@/db/schema";
import { logger } from "@/lib/logger";
import { toE164 } from "@/lib/sms-number-format";
import { looksSpanish } from "@/lib/spanish-signals";
import {
  LOOKBACK_DAYS,
  QUOTE_FOLLOWUP_KIND,
  QUOTE_FOLLOWUP_SMS_KIND,
  callerLines,
  isQuoteRequest,
  parseSettings,
  phoneKey,
  type FollowupStep,
  type QuoteFollowupSettings,
} from "./quote-followup";

/**
 * Data for quote follow-up texts. Every query is scoped by client_id.
 *
 * No migration: the on/off switch and templates live in
 * clients.setup_flags.quoteFollowup, the "already sent" ledger is
 * `notifications` rows (type lead, channel sms, payload.kind quote_followup),
 * and the outbound text itself is logged to the Messages inbox (sms_messages,
 * kind quote_followup_1 / quote_followup_2) by the notifier.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** A ledger row blocks a repeat of the same step to the same person for this long. */
const LEDGER_DAYS = 30;
/** A step that failed twice is left alone (a carrier-rejected number isn't retried forever). */
const MAX_FAILED_ATTEMPTS = 2;

export interface QuoteCandidate {
  /** E.164, ready to text. */
  phone: string;
  key: string;
  name: string | null;
  callId: string;
  /** The call that showed the quote request (the latest one for this number). */
  callAt: Date;
  callStartAt: Date;
  leadId: string | null;
  language: "en" | "es";
  facts: {
    bookedSince: boolean;
    hasUpcoming: boolean;
    repliedSince: boolean;
    calledBackSince: boolean;
    leadClosed: boolean;
    otherTextSince: boolean;
  };
  step1SentAt: Date | null;
  step2SentAt: Date | null;
}

interface LedgerRow {
  key: string;
  step: FollowupStep;
  status: string;
  at: Date;
}

async function ledgerRows(clientId: string, now: Date): Promise<LedgerRow[]> {
  const rows = await db
    .select({
      payload: notifications.payload,
      status: notifications.status,
      sentAt: notifications.sentAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(
      and(
        eq(notifications.clientId, clientId),
        eq(notifications.type, "lead"),
        sql`${notifications.payload}->>'kind' = ${QUOTE_FOLLOWUP_KIND}`,
        gte(notifications.createdAt, new Date(now.getTime() - LEDGER_DAYS * DAY)),
      ),
    )
    .orderBy(desc(notifications.createdAt))
    .limit(2000);
  const out: LedgerRow[] = [];
  for (const r of rows) {
    const p = (r.payload ?? {}) as { phoneKey?: string; step?: number };
    if (!p.phoneKey || (p.step !== 1 && p.step !== 2)) continue;
    out.push({ key: p.phoneKey, step: p.step, status: r.status, at: r.sentAt ?? r.createdAt });
  }
  return out;
}

/**
 * Everyone this business could owe a follow-up right now, with the facts the
 * stop rules need. Returns null if any query fails (send nothing rather than
 * guess), the same stance as the morning text.
 */
export async function loadQuoteCandidates(
  client: { id: string },
  now: Date = new Date(),
  /** How far back to look. The sender uses LOOKBACK_DAYS; the Pro teaser looks back 30. */
  lookbackDays: number = LOOKBACK_DAYS,
): Promise<QuoteCandidate[] | null> {
  try {
    const since = new Date(now.getTime() - lookbackDays * DAY);
    const rows = await db
      .select({
        callId: calls.id,
        fromNumber: calls.fromNumber,
        startAt: calls.startAt,
        endAt: calls.endAt,
        durationSec: calls.durationSec,
        summary: calls.summary,
        transcript: calls.transcript,
        leadId: leads.id,
        leadName: leads.name,
        leadPhone: leads.phone,
        leadReason: leads.reason,
        leadMessage: leads.message,
        leadService: leads.service,
        leadBudget: leads.budget,
        leadStatus: leads.status,
        leadLastReplyAt: leads.lastReplyAt,
        insightEntities: callInsights.entities,
        insightSpam: callInsights.isSpam,
        insightIntent: callInsights.intent,
      })
      .from(calls)
      .leftJoin(leads, and(eq(leads.callId, calls.id), eq(leads.clientId, client.id), isNull(leads.deletedAt)))
      .leftJoin(callInsights, and(eq(callInsights.callId, calls.id), eq(callInsights.clientId, client.id)))
      .where(
        and(
          eq(calls.clientId, client.id),
          isNull(calls.deletedAt),
          eq(calls.direction, "inbound"),
          gte(calls.startAt, since),
          // A booked call is done; spam isn't a customer; a transferred call was handled by a person.
          or(isNull(calls.outcome), notInArray(calls.outcome, ["booked", "spam", "escalated"])),
        ),
      )
      .orderBy(desc(calls.startAt))
      .limit(300);
    if (rows.length === 0) return [];

    // The latest qualifying call per number is the anchor for its two texts.
    const anchors = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      if (r.insightSpam || r.insightIntent === "spam" || r.insightIntent === "wrong_number" || r.insightIntent === "vendor_or_sales") {
        continue;
      }
      const e = (r.insightEntities ?? {}) as { service?: unknown };
      const qualifies = isQuoteRequest({
        leadReason: r.leadReason,
        leadMessage: r.leadMessage,
        leadService: r.leadService,
        leadBudget: r.leadBudget,
        summary: r.summary,
        transcript: r.transcript,
        insightService: typeof e.service === "string" ? e.service : null,
      });
      if (!qualifies) continue;
      const e164 = toE164(r.leadPhone) ?? toE164(r.fromNumber);
      const key = phoneKey(e164);
      if (!e164 || !key || !r.startAt) continue;
      const cur = anchors.get(key);
      if (!cur || (cur.startAt && r.startAt > cur.startAt)) anchors.set(key, r);
    }
    if (anchors.size === 0) return [];

    const minStart = new Date(Math.min(...[...anchors.values()].map((r) => r.startAt!.getTime())));

    const [appts, inbound, outbound, laterCalls, ledger] = await Promise.all([
      db
        .select({
          callId: appointments.callId,
          phone: appointments.customerPhone,
          createdAt: appointments.createdAt,
          startAt: appointments.startAt,
        })
        .from(appointments)
        .where(
          and(
            eq(appointments.clientId, client.id),
            isNull(appointments.deletedAt),
            ne(appointments.status, "cancelled"),
            ne(appointments.status, "no_show"),
            or(gte(appointments.createdAt, minStart), gt(appointments.startAt, now)),
          ),
        )
        .limit(2000),
      db
        .select({ phone: smsMessages.customerPhone, at: smsMessages.createdAt })
        .from(smsMessages)
        .where(
          and(
            eq(smsMessages.clientId, client.id),
            eq(smsMessages.direction, "inbound"),
            eq(smsMessages.kind, "reply"),
            gte(smsMessages.createdAt, minStart),
          ),
        )
        .limit(2000),
      db
        .select({ phone: smsMessages.customerPhone, at: smsMessages.createdAt, kind: smsMessages.kind })
        .from(smsMessages)
        .where(
          and(
            eq(smsMessages.clientId, client.id),
            eq(smsMessages.direction, "outbound"),
            gte(smsMessages.createdAt, minStart),
          ),
        )
        .limit(3000),
      db
        .select({ id: calls.id, fromNumber: calls.fromNumber, startAt: calls.startAt })
        .from(calls)
        .where(
          and(
            eq(calls.clientId, client.id),
            isNull(calls.deletedAt),
            eq(calls.direction, "inbound"),
            gte(calls.startAt, minStart),
          ),
        )
        .limit(3000),
      ledgerRows(client.id, now),
    ]);

    const out: QuoteCandidate[] = [];
    for (const [key, a] of anchors) {
      const callStartAt = a.startAt!;
      const callAt = a.endAt && a.endAt > callStartAt ? a.endAt : callStartAt;
      const e164 = (toE164(a.leadPhone) ?? toE164(a.fromNumber))!;

      const bookedSince = appts.some(
        (p) => p.callId === a.callId || (phoneKey(p.phone) === key && p.createdAt >= callStartAt),
      );
      const hasUpcoming = appts.some((p) => phoneKey(p.phone) === key && p.startAt > now);
      const repliedSince =
        Boolean(a.leadLastReplyAt && a.leadLastReplyAt >= callStartAt) ||
        inbound.some((m) => phoneKey(m.phone) === key && m.at >= callStartAt);
      const calledBackSince = laterCalls.some(
        (c) => c.id !== a.callId && phoneKey(c.fromNumber) === key && c.startAt && c.startAt > callStartAt,
      );
      const otherTextSince = outbound.some(
        (m) =>
          phoneKey(m.phone) === key &&
          m.at >= callStartAt &&
          !(m.kind ?? "").startsWith(QUOTE_FOLLOWUP_SMS_KIND),
      );

      const mine = ledger.filter((l) => l.key === key);
      const sentAt = (step: FollowupStep) =>
        mine
          .filter((l) => l.step === step && l.status !== "failed")
          .map((l) => l.at)
          .sort((x, y) => x.getTime() - y.getTime())[0] ?? null;

      // Spanish if we've heard them speak it: their saved language, else the words they used.
      const lang = (await savedLanguage(client.id, key)) ?? (looksSpanish(callerLines(a.transcript)) ? "es" : "en");

      out.push({
        phone: e164,
        key,
        name: a.leadName,
        callId: a.callId,
        callAt,
        callStartAt,
        leadId: a.leadId ?? null,
        language: lang === "es" ? "es" : "en",
        facts: {
          bookedSince,
          hasUpcoming,
          repliedSince,
          calledBackSince,
          leadClosed: a.leadStatus === "won" || a.leadStatus === "lost",
          otherTextSince,
        },
        step1SentAt: sentAt(1),
        step2SentAt: sentAt(2),
      });
    }
    return out;
  } catch (err) {
    logger.warn("quote_followup.query_failed", {
      clientId: client.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function savedLanguage(clientId: string, key: string): Promise<string | null> {
  const { getCustomerLanguage } = await import("@/lib/data/customer-languages");
  return getCustomerLanguage(clientId, `1${key}`);
}

/**
 * Claim one step for one person. Null = already sent, being sent, or failed
 * twice, so the caller must not send. The advisory lock makes two overlapping
 * cron runs line up: the second one sees the first one's row.
 */
export async function claimFollowup(input: {
  clientId: string;
  key: string;
  step: FollowupStep;
  phone: string;
  callId: string;
  leadId: string | null;
  now?: Date;
}): Promise<string | null> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`quote-followup:${input.clientId}:${input.key}:${input.step}`}))`,
    );
    const existing = await tx
      .select({ status: notifications.status })
      .from(notifications)
      .where(
        and(
          eq(notifications.clientId, input.clientId),
          eq(notifications.type, "lead"),
          sql`${notifications.payload}->>'kind' = ${QUOTE_FOLLOWUP_KIND}`,
          sql`${notifications.payload}->>'phoneKey' = ${input.key}`,
          sql`${notifications.payload}->>'step' = ${String(input.step)}`,
          gte(notifications.createdAt, new Date(now.getTime() - LEDGER_DAYS * DAY)),
        ),
      );
    if (existing.some((r) => r.status !== "failed")) return null;
    if (existing.length >= MAX_FAILED_ATTEMPTS) return null;
    const [row] = await tx
      .insert(notifications)
      .values({
        clientId: input.clientId,
        type: "lead",
        channel: "sms",
        recipient: input.phone,
        payload: {
          kind: QUOTE_FOLLOWUP_KIND,
          step: input.step,
          phoneKey: input.key,
          callId: input.callId,
          leadId: input.leadId,
          claimedAt: now.toISOString(),
        },
        status: "queued",
        createdAt: now,
      })
      .returning({ id: notifications.id });
    return row?.id ?? null;
  });
}

/** Record how a claimed send ended. `skipped` removes the claim: nothing left the building. */
export async function finishFollowup(
  id: string,
  outcome: { status: "sent" | "failed" | "skipped"; body: string; language: string; error?: string | null; providerSid?: string | null; at?: Date },
): Promise<void> {
  if (outcome.status === "skipped") {
    await db.delete(notifications).where(eq(notifications.id, id));
    return;
  }
  await db
    .update(notifications)
    .set({
      status: outcome.status,
      sentAt: outcome.status === "sent" ? (outcome.at ?? new Date()) : null,
      payload: sql`${notifications.payload} || ${JSON.stringify({
        body: outcome.body,
        language: outcome.language,
        error: outcome.error ?? null,
        providerSid: outcome.providerSid ?? null,
      })}::jsonb`,
    })
    .where(eq(notifications.id, id));
}

/** Follow-up texts this business has sent in the last 24 hours (for the daily cap). */
export async function sentInLastDay(clientId: string, now: Date = new Date()): Promise<number> {
  const rows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.clientId, clientId),
        eq(notifications.type, "lead"),
        inArray(notifications.status, ["queued", "sent"]),
        sql`${notifications.payload}->>'kind' = ${QUOTE_FOLLOWUP_KIND}`,
        gte(notifications.createdAt, new Date(now.getTime() - DAY)),
      ),
    );
  return rows.length;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/**
 * Save the switch and templates. A jsonb merge in one statement, so it can't
 * overwrite a flag another request wrote a moment earlier.
 */
export async function saveSettings(clientId: string, next: QuoteFollowupSettings): Promise<void> {
  const value: Record<string, unknown> = { enabled: next.enabled };
  if (next.enabledAt) value.enabledAt = next.enabledAt;
  if (next.step1Template) value.step1Template = next.step1Template;
  if (next.step2Template) value.step2Template = next.step2Template;
  value.askConsent = next.askConsent === true;
  await db
    .update(clients)
    .set({
      setupFlags: sql`${clients.setupFlags} || ${JSON.stringify({ quoteFollowup: value })}::jsonb` as unknown as (typeof clients.$inferInsert)["setupFlags"],
    })
    .where(eq(clients.id, clientId));
}

export async function getSettings(clientId: string): Promise<QuoteFollowupSettings> {
  const [row] = await db.select({ flags: clients.setupFlags }).from(clients).where(eq(clients.id, clientId)).limit(1);
  return parseSettings(row?.flags);
}

// ---------------------------------------------------------------------------
// Results for the portal
// ---------------------------------------------------------------------------

export interface QuoteFollowupStats {
  days: number;
  /** Texts that went out (both steps). */
  textsSent: number;
  /** Different people texted. */
  peopleTexted: number;
  /** People who texted back after our first text (within the window). */
  replies: number;
  /** People who booked after our first text and not before it. */
  bookingsAfter: number;
  /** Sum of listed service prices for those bookings, in cents. Null = no real value on file. */
  bookedValueCents: number | null;
  /** How many of those bookings had no listed price (never guessed). */
  bookingsWithoutPrice: number;
  /** Callers who asked for a price in the last 14 days. */
  askedRecently: number;
  /** Of those, how many have agreed to texts from this business. */
  askedAndAgreedToTexts: number;
}

const ATTRIBUTION_DAYS = 14;

export async function getQuoteFollowupStats(
  clientId: string,
  now: Date = new Date(),
  days = 30,
): Promise<QuoteFollowupStats | null> {
  try {
    const since = new Date(now.getTime() - days * DAY);
    const sent = (await ledgerRows(clientId, now)).filter((l) => l.status === "sent" && l.at >= since);

    const firstByKey = new Map<string, Date>();
    for (const l of sent) {
      const cur = firstByKey.get(l.key);
      if (!cur || l.at < cur) firstByKey.set(l.key, l.at);
    }
    let replies = 0;
    let bookingsAfter = 0;
    let value = 0;
    let priced = 0;
    let unpriced = 0;
    if (firstByKey.size > 0) {
      const minAt = new Date(Math.min(...[...firstByKey.values()].map((d) => d.getTime())));
      const [inbound, appts] = await Promise.all([
        db
          .select({ phone: smsMessages.customerPhone, at: smsMessages.createdAt })
          .from(smsMessages)
          .where(
            and(
              eq(smsMessages.clientId, clientId),
              eq(smsMessages.direction, "inbound"),
              eq(smsMessages.kind, "reply"),
              gte(smsMessages.createdAt, minAt),
            ),
          )
          .limit(3000),
        db
          .select({
            id: appointments.id,
            phone: appointments.customerPhone,
            createdAt: appointments.createdAt,
            priceCents: services.priceCents,
            priceFrom: services.priceFrom,
          })
          .from(appointments)
          .leftJoin(services, eq(services.id, appointments.serviceId))
          .where(
            and(
              eq(appointments.clientId, clientId),
              isNull(appointments.deletedAt),
              ne(appointments.status, "cancelled"),
              ne(appointments.status, "no_show"),
              gte(appointments.createdAt, minAt),
            ),
          )
          .limit(3000),
      ]);
      const counted = new Set<string>();
      for (const [key, first] of firstByKey) {
        const end = first.getTime() + ATTRIBUTION_DAYS * DAY;
        if (inbound.some((m) => phoneKey(m.phone) === key && m.at > first && m.at.getTime() <= end)) replies++;
        // One booking per person: the first one that came after our text.
        const booked = appts
          .filter((a) => phoneKey(a.phone) === key && a.createdAt > first && a.createdAt.getTime() <= end)
          .sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime())[0];
        if (booked && !counted.has(booked.id)) {
          counted.add(booked.id);
          bookingsAfter++;
          // "Starts at" prices are a floor, not what was charged: not a real value.
          if (booked.priceCents && booked.priceCents > 0 && !booked.priceFrom) {
            value += booked.priceCents;
            priced++;
          } else unpriced++;
        }
      }
    }

    // Context for an empty card: how many people asked, how many we're allowed to text.
    const cands = await loadQuoteCandidates({ id: clientId }, now);
    const asked = cands?.length ?? 0;
    let agreed = 0;
    if (cands && cands.length) {
      const { getConsentedPhones, isConsented } = await import("@/lib/data/sms-consents");
      const consented = await getConsentedPhones(clientId, "quote_followup");
      agreed = cands.filter((c) => isConsented(consented, c.phone)).length;
    }

    return {
      days,
      textsSent: sent.length,
      peopleTexted: firstByKey.size,
      replies,
      bookingsAfter,
      bookedValueCents: priced > 0 ? value : null,
      bookingsWithoutPrice: unpriced,
      askedRecently: asked,
      askedAndAgreedToTexts: agreed,
    };
  } catch (err) {
    logger.warn("quote_followup.stats_failed", {
      clientId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
