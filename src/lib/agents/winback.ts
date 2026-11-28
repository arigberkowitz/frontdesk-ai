import "server-only";
import { and, desc, eq, gt, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { appointments, clients, services, type Client } from "@/db/schema";
import { filterByFeature } from "@/lib/plan-access";
import { loadTextHistory, spamPhoneKeys } from "@/lib/data/revenue-texts";
import { revenueClientGate, sendRevenueTexts, type RevenueRecipient } from "@/lib/revenue-send";
import { localMonthKey, MIN_DAYS_BETWEEN_REVENUE_TEXTS, phoneKey } from "@/lib/revenue-texts";
import {
  isDueForWinback,
  MAX_WINBACK_MONTHS,
  MAX_WINBACK_PER_RUN,
  WINBACK_LOOKBACK_DAYS,
  winbackBody,
  winbackSettingsOf,
} from "@/lib/winback";
import { logger } from "@/lib/logger";
import { mapLimit, outOfBudget } from "./util";

/**
 * Win-back sweep (Pro). Runs daily; each business does one full pass per
 * calendar month in its own time zone. A pass that stops early (the per-run
 * cap, the end of the day's send hours, texting not approved) isn't marked
 * done, so the next day's run carries on where it stopped.
 */

const DAY = 86_400_000;

export interface PastCustomer {
  phone: string;
  name: string | null;
  serviceName: string | null;
  lastVisitAt: Date;
  appointmentId: string;
}

/**
 * Each past customer's most recent visit that actually happened: booked or
 * confirmed, start time in the past. Cancelled and no-show visits don't count
 * as "been in". Newest first, one row per phone.
 */
export async function pastCustomers(clientId: string, now = new Date()): Promise<PastCustomer[]> {
  const rows = await db
    .select({
      id: appointments.id,
      phone: appointments.customerPhone,
      name: appointments.customerName,
      startAt: appointments.startAt,
      serviceName: services.name,
    })
    .from(appointments)
    .leftJoin(services, eq(services.id, appointments.serviceId))
    .where(
      and(
        eq(appointments.clientId, clientId),
        inArray(appointments.status, ["booked", "confirmed"]),
        gte(appointments.startAt, new Date(now.getTime() - WINBACK_LOOKBACK_DAYS * DAY)),
        lte(appointments.startAt, now),
        isNull(appointments.deletedAt),
      ),
    )
    .orderBy(desc(appointments.startAt))
    .limit(5_000);
  const byPhone = new Map<string, PastCustomer>();
  for (const r of rows) {
    const key = phoneKey(r.phone);
    if (!key || byPhone.has(key)) continue;
    byPhone.set(key, {
      phone: r.phone!,
      name: r.name,
      serviceName: r.serviceName ?? null,
      lastVisitAt: r.startAt,
      appointmentId: r.id,
    });
  }
  return [...byPhone.values()];
}

/** Phone keys with a future booked/confirmed visit. */
export async function upcomingPhoneKeys(clientId: string, now = new Date()): Promise<Set<string>> {
  const rows = await db
    .select({ phone: appointments.customerPhone })
    .from(appointments)
    .where(
      and(
        eq(appointments.clientId, clientId),
        inArray(appointments.status, ["booked", "confirmed"]),
        gt(appointments.startAt, now),
        isNull(appointments.deletedAt),
      ),
    )
    .limit(5_000);
  return new Set(rows.map((r) => phoneKey(r.phone)).filter((k): k is string => Boolean(k)));
}

export interface WinbackRunResult {
  clientId: string;
  sent: number;
  failed: number;
  skipped?: string;
}

export async function winbackForClient(client: Client, now = new Date()): Promise<WinbackRunResult> {
  const base: WinbackRunResult = { clientId: client.id, sent: 0, failed: 0 };
  const settings = winbackSettingsOf(client.setupFlags);
  if (!settings.enabled) return { ...base, skipped: "off" };
  const month = localMonthKey(now, client.timezone);
  if (settings.lastRunMonth === month) return { ...base, skipped: "done_this_month" };

  const gate = await revenueClientGate(client, now);
  if (gate) return { ...base, skipped: gate };

  try {
    const [customers, upcoming, history, spam] = await Promise.all([
      pastCustomers(client.id, now),
      upcomingPhoneKeys(client.id, now),
      loadTextHistory(client.id, "winback", {
        kindWindowDays: MAX_WINBACK_MONTHS * 31,
        capWindowDays: MIN_DAYS_BETWEEN_REVENUE_TEXTS,
        now,
      }),
      spamPhoneKeys(client.id, now),
    ]);
    const due = customers.filter((c) => {
      const key = phoneKey(c.phone)!;
      return isDueForWinback(
        { lastVisitAt: c.lastVisitAt, hasUpcoming: upcoming.has(key), lastWinbackAt: history.lastOfKind.get(key) ?? null },
        settings.months,
        now,
      );
    });
    // Most recently lapsed first: they are the likeliest to come back.
    const recipients: RevenueRecipient[] = due.map((c) => ({
      phone: c.phone,
      appointmentId: c.appointmentId,
      body: (language) =>
        winbackBody(
          { business: client.name, firstName: c.name, serviceName: c.serviceName },
          { language, template: settings.template },
        ),
    }));
    const res = await sendRevenueTexts(client, {
      kind: "winback",
      purpose: "winback",
      recipients,
      history,
      spam,
      maxSends: MAX_WINBACK_PER_RUN,
      now,
    });
    logger.info("winback.run", { clientId: client.id, due: due.length, ...res });

    // Done for the month only when nothing was held back.
    if (!res.capped && !res.providerUnavailable) {
      await db
        .update(clients)
        .set({
          setupFlags: sql`jsonb_set(coalesce(${clients.setupFlags}, '{}'::jsonb), '{winback}',
            coalesce(${clients.setupFlags} -> 'winback', '{}'::jsonb) || jsonb_build_object('lastRunMonth', ${month}::text), true)`,
          updatedAt: sql`${clients.updatedAt}`,
        })
        .where(eq(clients.id, client.id));
    }
    return {
      ...base,
      sent: res.sent + res.queued,
      failed: res.failed,
      ...(res.providerUnavailable ? { skipped: "sms_not_configured" } : {}),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("winback.failed", { clientId: client.id, error: message });
    return { ...base, skipped: `error: ${message}` };
  }
}

/** Daily entry point: every business that turned win-back on AND is on Pro. */
export async function runWinback(budgetMs = 240_000, now = new Date()): Promise<WinbackRunResult[]> {
  const deadline = Date.now() + budgetMs;
  const enabled = await db.query.clients.findMany({
    where: and(
      inArray(clients.status, ["live", "trial"]),
      isNull(clients.deletedAt),
      sql`${clients.setupFlags} -> 'winback' ->> 'enabled' = 'true'`,
    ),
  });
  // The plan gate, enforced where the texts are sent — not just on the switch.
  const onPro = await filterByFeature(enabled, "winback");
  const gatedOut = enabled.length - onPro.length;
  if (gatedOut > 0) logger.info("winback.plan_gated", { count: gatedOut });
  return mapLimit(onPro, 3, async (client) => {
    if (outOfBudget(deadline)) return { clientId: client.id, sent: 0, failed: 0, skipped: "time_budget" };
    return winbackForClient(client, now);
  });
}
