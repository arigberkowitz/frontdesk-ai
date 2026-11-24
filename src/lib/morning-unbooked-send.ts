import "server-only";
import { and, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { clients, type Client } from "@/db/schema";
import { mapLimit, outOfBudget } from "@/lib/agents/util";
import { getAlertRecipients } from "@/lib/data/alert-contacts";
import {
  claimMorningUnbooked,
  finishMorningUnbooked,
  getUnbookedAfterHoursCallers,
} from "@/lib/data/morning-unbooked";
import { isOptedOut } from "@/lib/data/sms-optouts";
import { getTextingPrefs } from "@/lib/data/texting-prefs";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import {
  morningTextDue,
  morningUnbookedEnabled,
  morningWindow,
  renderMorningUnbookedText,
} from "@/lib/morning-unbooked";
import { notifier } from "@/lib/notifier";
import { planAccessFor } from "@/lib/plan-access";
import { inQuietHours } from "@/lib/texting-policy";

export interface MorningUnbookedRunResult {
  clients: number;
  optedOut: number;
  /** On, but it isn't 8–11am for them (or their quiet hours) right now. */
  notDue: number;
  /** Texting isn't carrier-approved yet (SMS_ENABLED off) — nothing goes out. */
  smsPending: number;
  /** On, but text alerts are off or there's no phone that may be texted. */
  noRecipient: number;
  /** Nobody to list (or the lookup failed) — no text by design. */
  nothingToSend: number;
  alreadySent: number;
  sent: number;
  skipped: number;
  failed: number;
}

function hourIn(at: Date, timeZone: string): number {
  const p = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).formatToParts(at);
  return Number(p.find((x) => x.type === "hour")?.value ?? 0) % 24;
}

/** The owner phones this may go to: the existing SMS-alert recipients, minus anyone who texted STOP. */
async function textableOwnerPhones(client: Client): Promise<string[]> {
  if (!client.smsAlertsEnabled) return [];
  const { phones } = await getAlertRecipients(client);
  const ok: string[] = [];
  for (const p of phones) {
    // No clientId: owner texts leave from the shared number, so any STOP blocks.
    if (!(await isOptedOut(p))) ok.push(p);
  }
  return ok;
}

/**
 * Morning cron: text each opted-in live/trial business the list of last
 * night's after-hours callers who didn't book — once per local day, 8–11am
 * their time, and only when there is someone to list.
 */
export async function sendMorningUnbookedTexts(
  now: Date = new Date(),
  opts: { budgetMs?: number } = {},
): Promise<MorningUnbookedRunResult> {
  const deadline = Date.now() + (opts.budgetMs ?? 240_000);
  const active = await db.query.clients.findMany({
    where: and(inArray(clients.status, ["live", "trial"]), isNull(clients.deletedAt)),
  });
  const r: MorningUnbookedRunResult = {
    clients: active.length,
    optedOut: 0,
    notDue: 0,
    smsPending: 0,
    noRecipient: 0,
    nothingToSend: 0,
    alreadySent: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
  };

  const due = active.filter((c) => {
    if (!morningUnbookedEnabled(c)) {
      r.optedOut++;
      return false;
    }
    if (!morningTextDue(now, c.timezone)) {
      r.notDue++;
      return false;
    }
    if (!env.SMS_ENABLED) {
      r.smsPending++;
      return false;
    }
    return true;
  });

  await mapLimit(due, 3, async (client) => {
    if (outOfBudget(deadline, 15_000)) {
      r.skipped++; // Not claimed, so the next slot picks it up.
      return;
    }
    let claim: string | null = null;
    const w = morningWindow(now, client.timezone);
    try {
      // Quiet hours the owner set for texts: wait for a later slot rather than ping early.
      const prefs = await getTextingPrefs(client.id);
      if (prefs && inQuietHours(hourIn(now, client.timezone), prefs.quietStartHour, prefs.quietEndHour)) {
        r.notDue++;
        return;
      }
      const to = await textableOwnerPhones(client);
      if (!to.length) {
        r.noRecipient++;
        return;
      }
      const callers = await getUnbookedAfterHoursCallers(client, w);
      if (!callers || callers.length === 0) {
        r.nothingToSend++;
        return;
      }
      claim = await claimMorningUnbooked(client.id, w.dayKey, to[0]);
      if (!claim) {
        r.alreadySent++;
        return;
      }
      const canAiCall = (await planAccessFor(client)).has("outbound_ai_calls");
      const body = renderMorningUnbookedText({
        businessName: client.name,
        callers,
        baseUrl: env.APP_URL,
        canAiCall,
      });
      if (!body) {
        await finishMorningUnbooked(claim, { status: "skipped", dayKey: w.dayKey, body: "", recipients: to, callers: 0 });
        r.nothingToSend++;
        return;
      }
      const results = [];
      for (const phone of to) results.push(await notifier.sendSms({ to: phone, body }));
      const anyOk = results.some((x) => x.ok);
      const allSkipped = results.every((x) => x.skipped);
      const status = anyOk ? "sent" : allSkipped ? "skipped" : "failed";
      await finishMorningUnbooked(claim, {
        status,
        dayKey: w.dayKey,
        body,
        recipients: to,
        callers: callers.length,
        error: results.find((x) => x.error)?.error ?? null,
      });
      if (status === "sent") r.sent++;
      else if (status === "skipped") r.skipped++;
      else r.failed++;
    } catch (err) {
      r.failed++;
      logger.error("morning_unbooked.client_failed", {
        clientId: client.id,
        error: err instanceof Error ? err.message : String(err),
      });
      // Release the day so a later slot retries.
      if (claim) {
        await finishMorningUnbooked(claim, {
          status: "failed",
          dayKey: w.dayKey,
          body: "",
          recipients: [],
          callers: 0,
          error: err instanceof Error ? err.message : String(err),
        }).catch(() => undefined);
      }
    }
  });

  logger.info("morning_unbooked.run", { ...r });
  return r;
}
