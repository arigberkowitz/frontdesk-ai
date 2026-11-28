import "server-only";
import { and, desc, eq, gte, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { appointments, callInsights, calls, smsMessages } from "@/db/schema";
import { logger } from "@/lib/logger";
import {
  CAPPED_TEXT_KINDS,
  EMPTY_STATS,
  phoneKey,
  type RevenueTextStats,
} from "@/lib/revenue-texts";

/**
 * Reads behind the Pro revenue texts. The history is `sms_messages` — the same
 * rows the Messages inbox shows — so dedupe, the shared per-person cap and the
 * dashboard numbers can never disagree with what the owner sees was sent.
 */

const DAY = 86_400_000;

export interface TextHistory {
  /** Last capped text (any revenue/nudge kind) per phone key, last few days. */
  lastCapped: Map<string, Date>;
  /** Last text of `kind` per phone key, any status (a failed attempt counts: no retry storms). */
  lastOfKind: Map<string, Date>;
  /** Count of texts of `kind` per phone key in the window. */
  countOfKind: Map<string, number>;
  /** Revenue texts this business sent in the last 24 hours, all kinds. */
  sentLast24h: number;
}

/**
 * One read of this business's outbound history for the sweep. THROWS on a DB
 * error on purpose: without history there is no dedupe, and without dedupe
 * the safe number of texts to send is zero.
 */
export async function loadTextHistory(
  clientId: string,
  kind: string,
  opts: { kindWindowDays: number; capWindowDays: number; now?: Date },
): Promise<TextHistory> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - Math.max(opts.kindWindowDays, opts.capWindowDays, 1) * DAY);
  const rows = await db
    .select({ phone: smsMessages.customerPhone, kind: smsMessages.kind, createdAt: smsMessages.createdAt })
    .from(smsMessages)
    .where(
      and(
        eq(smsMessages.clientId, clientId),
        eq(smsMessages.direction, "outbound"),
        inArray(smsMessages.kind, [...new Set([...CAPPED_TEXT_KINDS, kind])]),
        gte(smsMessages.createdAt, since),
      ),
    )
    .orderBy(desc(smsMessages.createdAt))
    .limit(10_000);

  const capSince = now.getTime() - opts.capWindowDays * DAY;
  const kindSince = now.getTime() - opts.kindWindowDays * DAY;
  const out: TextHistory = { lastCapped: new Map(), lastOfKind: new Map(), countOfKind: new Map(), sentLast24h: 0 };
  for (const r of rows) {
    const key = phoneKey(r.phone);
    if (!key) continue;
    const t = r.createdAt.getTime();
    if (CAPPED_TEXT_KINDS.includes(r.kind ?? "") && t >= capSince && !out.lastCapped.has(key)) {
      out.lastCapped.set(key, r.createdAt);
    }
    if (r.kind === kind && t >= kindSince) {
      if (!out.lastOfKind.has(key)) out.lastOfKind.set(key, r.createdAt);
      out.countOfKind.set(key, (out.countOfKind.get(key) ?? 0) + 1);
    }
    if (CAPPED_TEXT_KINDS.includes(r.kind ?? "") && t >= now.getTime() - DAY) out.sentLast24h += 1;
  }
  return out;
}

/**
 * Numbers our call log marked as spam for this business (a spam outcome or the
 * post-call check's spam flag). Phone keys. THROWS on a DB error, like the
 * history: a sweep that can't tell a robocaller from a customer stops.
 */
export async function spamPhoneKeys(clientId: string, now = new Date()): Promise<Set<string>> {
  const since = new Date(now.getTime() - 365 * DAY);
  const rows = await db
    .select({ from: calls.fromNumber })
    .from(calls)
    .leftJoin(callInsights, eq(callInsights.callId, calls.id))
    .where(
      and(
        eq(calls.clientId, clientId),
        gte(calls.createdAt, since),
        or(eq(calls.outcome, "spam"), eq(callInsights.isSpam, true)),
      ),
    )
    .limit(5_000);
  const out = new Set<string>();
  for (const r of rows) {
    const key = phoneKey(r.from);
    if (key) out.add(key);
  }
  return out;
}

/**
 * The results line for one kind of text: what was sent, who replied, who
 * booked afterward. Counts only, from rows that exist. Never throws (an empty
 * result hides the line).
 */
export async function revenueTextStats(
  clientId: string,
  kind: string,
  days = 30,
  now = new Date(),
): Promise<RevenueTextStats> {
  try {
    const since = new Date(now.getTime() - days * DAY);
    const sent = await db
      .select({ phone: smsMessages.customerPhone, status: smsMessages.status, createdAt: smsMessages.createdAt })
      .from(smsMessages)
      .where(
        and(
          eq(smsMessages.clientId, clientId),
          eq(smsMessages.direction, "outbound"),
          eq(smsMessages.kind, kind),
          gte(smsMessages.createdAt, since),
        ),
      )
      .limit(5_000);
    if (sent.length === 0) return { ...EMPTY_STATS };

    const ok = sent.filter((r) => r.status !== "failed");
    const firstTextAt = new Map<string, Date>();
    for (const r of ok) {
      const key = phoneKey(r.phone);
      if (!key) continue;
      const prev = firstTextAt.get(key);
      if (!prev || r.createdAt < prev) firstTextAt.set(key, r.createdAt);
    }
    const stats: RevenueTextStats = {
      sent: ok.length,
      people: firstTextAt.size,
      failed: sent.length - ok.length,
      replied: 0,
      bookedAfter: 0,
    };
    if (firstTextAt.size === 0) return stats;

    const earliest = new Date(Math.min(...[...firstTextAt.values()].map((d) => d.getTime())));
    const [inbound, booked] = await Promise.all([
      db
        .select({ phone: smsMessages.customerPhone, createdAt: smsMessages.createdAt })
        .from(smsMessages)
        .where(
          and(
            eq(smsMessages.clientId, clientId),
            eq(smsMessages.direction, "inbound"),
            gte(smsMessages.createdAt, earliest),
          ),
        )
        .limit(5_000),
      db
        .select({ phone: appointments.customerPhone, createdAt: appointments.createdAt })
        .from(appointments)
        .where(
          and(
            eq(appointments.clientId, clientId),
            gte(appointments.createdAt, earliest),
            isNull(appointments.deletedAt),
          ),
        )
        .limit(5_000),
    ]);
    const within = (rows: { phone: string | null; createdAt: Date }[], windowDays: number) => {
      const hit = new Set<string>();
      for (const r of rows) {
        const key = phoneKey(r.phone);
        const first = key ? firstTextAt.get(key) : undefined;
        if (!key || !first) continue;
        const dt = r.createdAt.getTime() - first.getTime();
        if (dt >= 0 && dt <= windowDays * DAY) hit.add(key);
      }
      return hit.size;
    };
    stats.replied = within(inbound, 7);
    stats.bookedAfter = within(booked, 14);
    return stats;
  } catch (err) {
    logger.warn("revenue_texts.stats_failed", {
      clientId,
      kind,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ...EMPTY_STATS };
  }
}
