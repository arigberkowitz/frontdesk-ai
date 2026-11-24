/**
 * "Text back or call back?" — which follow-up gets missed callers to respond
 * and book. Pure math + wording; the SQL lives in src/lib/data/followup-channels.ts.
 *
 * What's compared: missed / dropped-call follow-ups (call_callbacks rows with
 * status 'sent'), split by the channel that actually went out — a text-back
 * ('sms') or an AI phone callback ('ai_call'). Both fire on the same trigger
 * (a caller left without what they came for), so it's like for like.
 *
 * Attribution rule (documented in the PR and on the card):
 *  - Responded: within FOLLOWUP_WINDOW_DAYS after the follow-up went out, that
 *    caller texted back (a real reply, not STOP/HELP) or called the business
 *    again — or, for an AI callback, picked up and talked (call lasted at least
 *    PICKUP_MIN_SECONDS and didn't end at voicemail / no answer).
 *  - Booked: an appointment for that caller's number was CREATED within
 *    FOLLOWUP_WINDOW_DAYS after the follow-up went out, and isn't cancelled or
 *    a no-show.
 *
 * Not counted: calls an owner returns from their own phone (nothing records
 * them), and lead follow-up texts (no call-back counterpart to compare with).
 */

export const FOLLOWUP_LOOKBACK_DAYS = 30;
export const FOLLOWUP_WINDOW_DAYS = 7;
export const PICKUP_MIN_SECONDS = 10;
/** Below this many follow-ups on a channel, its rates aren't shown. */
export const MIN_SAMPLE_PER_CHANNEL = 5;
/** A gap smaller than this (in percentage points) reads as "about the same". */
export const MEANINGFUL_GAP_POINTS = 10;

export type FollowUpChannel = "sms" | "ai_call";

export type ChannelCounts = { sent: number; responded: number; booked: number };

export type ChannelStats = ChannelCounts & {
  /** True when sent >= MIN_SAMPLE_PER_CHANNEL; rates are null otherwise. */
  enough: boolean;
  respondedPct: number | null;
  bookedPct: number | null;
};

export type FollowUpComparison = {
  days: number;
  windowDays: number;
  text: ChannelStats;
  call: ChannelStats;
  /** Both channels have enough data to compare. */
  comparable: boolean;
  /** Which channel booked more, when comparable and the gap is meaningful. */
  leader: "text" | "call" | "tie" | null;
};

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

function toCount(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function channelStats(c: Partial<ChannelCounts> | undefined): ChannelStats {
  const sent = toCount(c?.sent);
  // A response or booking can't outnumber follow-ups sent.
  const responded = Math.min(toCount(c?.responded), sent);
  const booked = Math.min(toCount(c?.booked), sent);
  const enough = sent >= MIN_SAMPLE_PER_CHANNEL;
  return {
    sent,
    responded,
    booked,
    enough,
    respondedPct: enough ? pct(responded, sent) : null,
    bookedPct: enough ? pct(booked, sent) : null,
  };
}

/** Rows from the grouped query → the card's model. Null = nothing sent yet (hide the card). */
export function compareFollowUps(
  rows: { channel: string | null; sent: unknown; responded: unknown; booked: unknown }[],
  opts: { days?: number; windowDays?: number } = {},
): FollowUpComparison | null {
  const by = (ch: FollowUpChannel) => {
    const r = rows.find((x) => x.channel === ch);
    return r ? { sent: toCount(r.sent), responded: toCount(r.responded), booked: toCount(r.booked) } : undefined;
  };
  const text = channelStats(by("sms"));
  const call = channelStats(by("ai_call"));
  if (text.sent + call.sent === 0) return null;
  const comparable = text.enough && call.enough;
  let leader: FollowUpComparison["leader"] = null;
  if (comparable) {
    const gap = (text.bookedPct ?? 0) - (call.bookedPct ?? 0);
    leader = Math.abs(gap) < MEANINGFUL_GAP_POINTS ? "tie" : gap > 0 ? "text" : "call";
  }
  return {
    days: opts.days ?? FOLLOWUP_LOOKBACK_DAYS,
    windowDays: opts.windowDays ?? FOLLOWUP_WINDOW_DAYS,
    text,
    call,
    comparable,
    leader,
  };
}

/** One plain sentence for the top of the card, built only from the counts. */
export function comparisonHeadline(c: FollowUpComparison): string {
  if (!c.comparable) {
    return `Not enough data yet to compare. We show rates once each kind of follow-up has gone to at least ${MIN_SAMPLE_PER_CHANNEL} callers.`;
  }
  const t = `${c.text.bookedPct}%`;
  const k = `${c.call.bookedPct}%`;
  if (c.leader === "tie") {
    return `About the same so far: ${t} of callers booked after a text back, ${k} after an AI call back.`;
  }
  return c.leader === "text"
    ? `Text backs are booking more: ${t} of callers booked after a text, ${k} after an AI call back.`
    : `AI call backs are booking more: ${k} of callers booked after a call, ${t} after a text back.`;
}
