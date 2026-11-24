import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { callCallbacks } from "@/db/schema";
import {
  compareFollowUps,
  FOLLOWUP_LOOKBACK_DAYS,
  FOLLOWUP_WINDOW_DAYS,
  PICKUP_MIN_SECONDS,
  type FollowUpComparison,
} from "@/lib/followup-channels";
import { logger } from "@/lib/logger";

/**
 * Text back vs AI call back, for one business, over the last
 * FOLLOWUP_LOOKBACK_DAYS days of sent missed-call follow-ups. The attribution
 * rule is documented in src/lib/followup-channels.ts. Scoped by client_id on
 * every table; the caller verifies client ownership first.
 *
 * Fail-soft: any error (e.g. call_callbacks not migrated yet) returns null and
 * the card hides, so the page never shows a number we didn't measure.
 */
export async function getFollowUpComparison(clientId: string): Promise<FollowUpComparison | null> {
  const cc = alias(callCallbacks, "cc");
  const lookback = sql.raw(`interval '${FOLLOWUP_LOOKBACK_DAYS} days'`);
  const win = sql.raw(`interval '${FOLLOWUP_WINDOW_DAYS} days'`);
  const pickupSec = sql.raw(String(PICKUP_MIN_SECONDS));
  // Same number-matching rule as the month value card: last 10 digits.
  const repliedOrCalledIn = sql`(
    exists (
      select 1 from sms_messages m
      where m.client_id = cc.client_id
        and m.direction = 'inbound'
        and m.kind = 'reply'
        and m.created_at > cc.sent_at
        and m.created_at <= cc.sent_at + ${win}
        and right(m.customer_phone, 10) = right(cc.customer_phone, 10)
    )
    or exists (
      select 1 from calls c
      where c.client_id = cc.client_id
        and c.deleted_at is null
        and c.direction = 'inbound'
        and c.start_at > cc.sent_at
        and c.start_at <= cc.sent_at + ${win}
        and right(regexp_replace(coalesce(c.from_number, ''), '[^0-9]', '', 'g'), 10) = right(cc.customer_phone, 10)
    )
  )`;
  // The AI callback itself was answered by a person: it ran long enough to be a
  // conversation and didn't end at voicemail / an answering machine / no answer.
  const pickedUp = sql`(
    cc.channel = 'ai_call' and cc.retell_call_id is not null and exists (
      select 1 from calls oc
      where oc.client_id = cc.client_id
        and oc.deleted_at is null
        and oc.retell_call_id = cc.retell_call_id
        and coalesce(oc.duration_sec, 0) >= ${pickupSec}
        and coalesce(oc.raw_payload -> 'call' ->> 'disconnection_reason', '') not in ('voicemail_reached', 'machine_detected')
        and coalesce(oc.raw_payload -> 'call' ->> 'disconnection_reason', '') not like 'dial%'
    )
  )`;
  const booked = sql`exists (
    select 1 from appointments a
    where a.client_id = cc.client_id
      and a.deleted_at is null
      and a.status not in ('cancelled', 'no_show')
      and a.created_at >= cc.sent_at
      and a.created_at <= cc.sent_at + ${win}
      and right(regexp_replace(coalesce(a.customer_phone, ''), '[^0-9]', '', 'g'), 10) = right(cc.customer_phone, 10)
  )`;

  try {
    const rows = await db
      .select({
        channel: cc.channel,
        sent: sql<number>`count(*)::int`,
        responded: sql<number>`count(*) filter (where ${repliedOrCalledIn} or ${pickedUp})::int`,
        booked: sql<number>`count(*) filter (where ${booked})::int`,
      })
      .from(cc)
      .where(
        and(
          eq(cc.clientId, clientId),
          eq(cc.status, "sent"),
          inArray(cc.channel, ["sms", "ai_call"]),
          sql`${cc.sentAt} is not null`,
          sql`${cc.sentAt} >= now() - ${lookback}`,
        ),
      )
      .groupBy(cc.channel);
    return compareFollowUps(rows);
  } catch (err) {
    logger.warn("followup_channels.read_failed", {
      clientId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
