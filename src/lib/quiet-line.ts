import "server-only";
import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { calls, clients, notifications, type Client } from "@/db/schema";
import { notifier } from "./notifier";
import { formatPhone } from "./format";
import { tzDayKey } from "./tz";
import { logger } from "./logger";

/**
 * "Your line went quiet" — the safety net under call forwarding.
 *
 * Nothing in this product can read a carrier's forwarding setting. `*72` lives
 * at Verizon or Comcast, not here, and there is no API. So when forwarding
 * silently lapses — a phone reset, a new handset, a carrier migration, someone
 * dialing `*73` and forgetting — the business just stops getting calls and
 * nobody finds out until a customer complains that nobody ever picks up.
 *
 * What we CAN see is silence on our side. A business that reliably took calls
 * and then took none for two full open days is either having a very strange
 * week or is no longer forwarded. Both are worth an email.
 *
 * This is deliberately a heuristic, and the message says so. The failure we're
 * protecting against is silent and expensive; the cost of being wrong is one
 * email that says "if you're just having a quiet week, ignore this."
 */

/** Don't guess from thin data — a client with no established rhythm has no anomaly. */
const MIN_BASELINE_CALLS = 8;
const BASELINE_DAYS = 28;
/** Full open days of silence before we say anything. */
const QUIET_OPEN_DAYS = 2;
/** Never nag more than this often, however long the silence runs. */
const REALERT_AFTER_DAYS = 7;

const DAY_MS = 86_400_000;

/** Which weekdays (0=Sun) this client is actually open, in their own zone. */
function openWeekdays(
  hours: Array<{ dayOfWeek: number; isClosed: boolean; openTime: string | null }>,
) {
  return new Set(hours.filter((h) => !h.isClosed && h.openTime).map((h) => h.dayOfWeek));
}

/**
 * Open days between two instants, counted in the business's timezone.
 *
 * A Friday-evening-to-Monday-morning gap is ~60 hours and zero open days, which
 * is exactly why this can't be an hour threshold — it would cry wolf every
 * weekend.
 *
 * Counts CALENDAR days, not 24-hour periods. Stepping by 24h from the last call
 * makes the answer depend on what time of day that call happened, so a 9am
 * Monday call and an 11pm Monday call would disagree about whether Wednesday has
 * arrived. We resolve both endpoints to local dates first and then do plain
 * date arithmetic in UTC, where a "day" is exactly 24h and DST can't bite.
 */
export function openDaysBetween(
  fromMs: number,
  toMs: number,
  timeZone: string,
  open: Set<number>,
): number {
  const dayStart = (ms: number) => {
    const [y, m, d] = tzDayKey(ms, timeZone).split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  const from = dayStart(fromMs);
  const to = dayStart(toMs);

  let count = 0;
  // Every local date after the day of the last call, through today. Today counts
  // — by the time this runs mid-morning, a normally-busy line having taken
  // nothing yet is already information.
  for (let t = from + DAY_MS; t <= to; t += DAY_MS) {
    if (open.has(new Date(t).getUTCDay())) count++;
  }
  return count;
}

export interface QuietLineResult {
  checked: number;
  alerted: number;
  reasons: Record<string, number>;
  /** Clients whose check threw. Non-zero means this run missed someone. */
  failed: number;
}

export async function checkQuietLines(now: Date = new Date()): Promise<QuietLineResult> {
  const nowMs = now.getTime();
  const reasons: Record<string, number> = {};
  const skip = (why: string) => {
    reasons[why] = (reasons[why] ?? 0) + 1;
  };

  const active = await db.query.clients.findMany({
    where: and(inArray(clients.status, ["live", "trial"]), isNull(clients.deletedAt)),
    with: { businessHours: true },
  });

  let alerted = 0;
  let failed = 0;

  // This whole job exists to notice silence. It would be a poor joke if one
  // client's error made it fall silent about everyone else's.
  for (const client of active) {
    try {
      // Only businesses that told us forwarding is on. Without that, silence is
      // just a business that hasn't finished setting up.
      if (!client.setupFlags?.forwardingDone || !client.retellPhoneNumber) {
        skip("not_forwarded");
        continue;
      }

      const last = client.setupFlags.quietAlertAt;
      if (last && nowMs - Date.parse(last) < REALERT_AFTER_DAYS * DAY_MS) {
        skip("recently_alerted");
        continue;
      }

      const open = openWeekdays(client.businessHours);
      if (open.size === 0) {
        skip("no_open_days");
        continue;
      }

      const since = new Date(nowMs - BASELINE_DAYS * DAY_MS);
      const recent = await db.query.calls.findMany({
        where: and(
          eq(calls.clientId, client.id),
          eq(calls.direction, "inbound"),
          gte(calls.startAt, since),
          isNull(calls.deletedAt),
        ),
        orderBy: [desc(calls.startAt)],
        columns: { startAt: true },
      });

      if (recent.length < MIN_BASELINE_CALLS) {
        skip("no_baseline");
        continue;
      }

      const lastCallAt = recent[0]?.startAt;
      if (!lastCallAt) {
        skip("no_baseline");
        continue;
      }

      const quietDays = openDaysBetween(
        lastCallAt.getTime(),
        nowMs,
        client.timezone ?? "America/Los_Angeles",
        open,
      );
      if (quietDays < QUIET_OPEN_DAYS) {
        skip("still_active");
        continue;
      }

      await sendQuietAlert(client, lastCallAt, recent.length, quietDays);
      alerted++;
    } catch (err) {
      failed++;
      logger.error("quiet_line.client_failed", {
        clientId: client.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info("quiet_line.run", { checked: active.length, alerted, reasons, failed });
  return { checked: active.length, alerted, reasons, failed };
}

async function sendQuietAlert(
  client: Client,
  lastCallAt: Date,
  baselineCalls: number,
  quietDays: number,
): Promise<void> {
  const tz = client.timezone ?? "America/Los_Angeles";
  const when = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(lastCallAt);
  const aiNumber = formatPhone(client.retellPhoneNumber);
  const perWeek = Math.round((baselineCalls / BASELINE_DAYS) * 7);

  const line1 = `Your AI hasn't answered a call since ${when} — that's ${quietDays} open days with nothing coming through.`;
  const line2 = `You normally take around ${perWeek} calls a week, so this might mean call forwarding got switched off. That happens after a phone reset, a carrier change, or someone dialling *73.`;
  const line3 = `To turn it back on: from your business phone, dial *72 ${aiNumber}, wait for the tone, and hang up.`;
  const line4 = `If you're just having a quiet week, ignore this — we can't see your carrier's settings, only that the calls stopped.`;
  const text = [line1, line2, line3, line4].join("\n\n");

  const subject = `${client.name}: your AI hasn't taken a call in ${quietDays} days`;

  if (client.ownerEmail?.trim()) {
    const html = `<p>${line1}</p><p>${line2}</p><p>${line3.replace(
      `*72 ${aiNumber}`,
      `<strong>*72 ${aiNumber}</strong>`,
    )}</p><p style="color:#666">${line4}</p>`;
    const result = await notifier.sendEmail({
      to: client.ownerEmail.trim(),
      subject,
      html,
      text,
    });
    await db.insert(notifications).values({
      clientId: client.id,
      type: "system",
      channel: "email",
      recipient: client.ownerEmail.trim(),
      payload: { kind: "quiet_line", quietDays, lastCallAt: lastCallAt.toISOString() },
      status: result.skipped ? "queued" : result.ok ? "sent" : "failed",
      sentAt: result.ok ? new Date() : null,
    });
  }

  // SMS only if they opted into text alerts — this is important, not urgent.
  const sms = client.escalationNumber?.trim();
  if (sms && client.smsAlertsEnabled) {
    const body = `${client.name}: your AI hasn't taken a call since ${when}. Forwarding may be off — dial *72 ${aiNumber} from your business phone to turn it back on.`;
    const result = await notifier.sendSms({ to: sms, body });
    await db.insert(notifications).values({
      clientId: client.id,
      type: "system",
      channel: "sms",
      recipient: sms,
      payload: { kind: "quiet_line", quietDays },
      status: result.skipped ? "queued" : result.ok ? "sent" : "failed",
      sentAt: result.ok ? new Date() : null,
    });
  }

  await db
    .update(clients)
    .set({ setupFlags: { ...client.setupFlags, quietAlertAt: new Date().toISOString() } })
    .where(eq(clients.id, client.id));
}
