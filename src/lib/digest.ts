import "server-only";
import { and, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { clients, notifications } from "@/db/schema";
import { getClientPeriodSummary } from "./data/metrics";
import { notifier } from "./notifier";
import { formatCurrencyCents } from "./format";
import { logger } from "./logger";

export type DigestPeriod = "daily" | "weekly";

/**
 * Owner digest per client (§E3): a short SMS of what the AI caught over the
 * period, logged to `notifications` (§E4). Clients with no activity are skipped
 * to avoid noise. Owner email digests follow once we capture an owner email.
 */
export async function sendDigests(
  period: DigestPeriod,
): Promise<{ clients: number; sent: number; skipped: number }> {
  const sinceDays = period === "daily" ? 1 : 7;
  const label = period === "daily" ? "today" : "this week";

  const active = await db.query.clients.findMany({
    where: and(inArray(clients.status, ["live", "trial"]), isNull(clients.deletedAt)),
  });

  let sent = 0;
  let skipped = 0;

  for (const client of active) {
    const s = await getClientPeriodSummary(client.id, sinceDays);
    if (s.calls === 0 && s.bookings === 0 && s.leads === 0) {
      skipped++;
      continue;
    }
    const to = client.escalationNumber?.trim();
    if (!to) {
      skipped++;
      continue;
    }

    const body = `📊 ${client.name} — ${label}: ${s.calls} calls answered, ${s.bookings} booked, ${s.leads} leads, ${s.afterHours} after-hours saves. Est. revenue captured: ${formatCurrencyCents(
      s.estRevenueCents,
    )}.`;
    const result = await notifier.sendSms({ to, body });
    await db.insert(notifications).values({
      clientId: client.id,
      type: period === "daily" ? "digest_daily" : "digest_weekly",
      channel: "sms",
      recipient: to,
      payload: { body, summary: s },
      status: result.skipped ? "queued" : result.ok ? "sent" : "failed",
      sentAt: result.ok ? new Date() : null,
    });
    if (result.ok) sent++;
    else skipped++;
  }

  logger.info("digest.run", { period, clients: active.length, sent, skipped });
  return { clients: active.length, sent, skipped };
}
