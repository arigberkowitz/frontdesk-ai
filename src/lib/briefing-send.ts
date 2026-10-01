import "server-only";
import { and, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { clients, type Client } from "@/db/schema";
import { writeBriefing } from "@/lib/agents/briefing";
import { mapLimit, outOfBudget } from "@/lib/agents/util";
import { briefingDue, renderBriefing, type BriefingFacts, type RenderedBriefing } from "@/lib/daily-briefing";
import { claimDailyBriefing, finishDailyBriefing, getBriefingFacts } from "@/lib/data/daily-briefing";
import { notifier } from "@/lib/notifier";
import { env } from "@/lib/env";
import { tzDayKey } from "@/lib/tz";
import { logger } from "@/lib/logger";

/** Is the daily briefing switched on for this business? Opt-in. */
export function dailyBriefingEnabled(client: Pick<Client, "setupFlags">): boolean {
  return client.setupFlags?.dailyBriefing === true;
}

/**
 * Build one business's briefing for right now without sending or recording
 * anything — the portal preview uses this, and so does the cron before it sends.
 */
export async function renderDailyBriefingForClient(
  client: Pick<Client, "id" | "name" | "timezone">,
  now: Date = new Date(),
): Promise<RenderedBriefing & { facts: BriefingFacts; usedAi: boolean }> {
  const facts = await getBriefingFacts(client, now);
  const ai = await writeBriefing(facts, now);
  return { ...renderBriefing({ facts, ai, baseUrl: env.APP_URL }), facts, usedAi: Boolean(ai) };
}

export interface DailyBriefingRunResult {
  clients: number;
  /** Opted in, but it isn't 7–10am for them right now. */
  notDue: number;
  optedOut: number;
  alreadySent: number;
  sent: number;
  skipped: number;
  failed: number;
}

/**
 * Morning cron: email each opted-in live/trial business its briefing once
 * per local day, between 7 and 10am in the business's own timezone. Runs from
 * several daily cron slots (see vercel.json); each slot only touches the
 * businesses for whom it's currently morning, and the per-day claim makes
 * any overlap harmless.
 */
export async function sendDailyBriefings(
  now: Date = new Date(),
  opts: { budgetMs?: number } = {},
): Promise<DailyBriefingRunResult> {
  const deadline = Date.now() + (opts.budgetMs ?? 240_000);
  const active = await db.query.clients.findMany({
    where: and(inArray(clients.status, ["live", "trial"]), isNull(clients.deletedAt)),
  });

  const r: DailyBriefingRunResult = {
    clients: active.length,
    notDue: 0,
    optedOut: 0,
    alreadySent: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
  };

  const due = active.filter((c) => {
    if (!dailyBriefingEnabled(c)) {
      r.optedOut++;
      return false;
    }
    if (!briefingDue(now, c.timezone)) {
      r.notDue++;
      return false;
    }
    if (!c.ownerEmail?.trim()) {
      r.skipped++;
      return false;
    }
    return true;
  });

  await mapLimit(due, 3, async (client) => {
    if (outOfBudget(deadline, 15_000)) {
      // Not claimed, so the next slot picks it up.
      r.skipped++;
      return;
    }
    const to = client.ownerEmail!.trim();
    const dayKey = tzDayKey(now, client.timezone);
    let claim: string | null = null;
    try {
      claim = await claimDailyBriefing(client.id, dayKey, to);
      if (!claim) {
        r.alreadySent++;
        return;
      }
      const b = await renderDailyBriefingForClient(client, now);
      const result = await notifier.sendEmail({ to, subject: b.subject, html: b.html, text: b.text });
      const status = result.ok ? "sent" : result.skipped ? "skipped" : "failed";
      await finishDailyBriefing(claim, {
        status,
        dayKey: b.facts.dayKey,
        subject: b.subject,
        card: b.card,
        usedAi: b.usedAi,
        error: result.error ?? null,
      });
      if (result.ok) r.sent++;
      else if (result.skipped) r.skipped++;
      else r.failed++;
    } catch (err) {
      r.failed++;
      logger.error("briefing.client_failed", {
        clientId: client.id,
        error: err instanceof Error ? err.message : String(err),
      });
      // Release the day so a later slot retries instead of silently skipping it.
      if (claim) {
        await finishDailyBriefing(claim, {
          status: "failed",
          dayKey,
          subject: "",
          card: { dayKey, opening: "", quiet: true, callbacks: [], todayCount: 0, calls: 0, bookingsMade: 0, cancellations: 0 },
          usedAi: false,
          error: err instanceof Error ? err.message : String(err),
        }).catch(() => undefined);
      }
    }
  });

  logger.info("briefing.run", { ...r });
  return r;
}
