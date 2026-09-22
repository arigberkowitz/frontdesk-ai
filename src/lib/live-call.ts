/**
 * What counts as "on a call right now".
 *
 * The Retell webhook writes a row at `call_started` with no `endAt`; the
 * `call_ended` event fills it in. So an open row is a live call — unless the
 * end event was lost, in which case the row stays open forever and the strip
 * would announce a call from last Tuesday. Cap it: nothing this product
 * handles runs an hour, so an open row older than that is a lost event, not a
 * caller. Pure, so the rule is testable.
 */
export const LIVE_MAX_AGE_MS = 60 * 60_000;

export interface OpenCall {
  id: string;
  startAt: Date | null;
  endAt: Date | null;
}

export function isLive(call: OpenCall, now = new Date()): boolean {
  if (!call.startAt || call.endAt) return false;
  return now.getTime() - call.startAt.getTime() < LIVE_MAX_AGE_MS;
}

/** "0:42", "12:05" — what a phone shows while you're on a call. */
export function elapsed(startAt: Date, now = new Date()): string {
  const s = Math.max(0, Math.floor((now.getTime() - startAt.getTime()) / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}
