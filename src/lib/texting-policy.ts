/**
 * Owner texting controls, as pure functions.
 *
 * - Texting off: automated customer texts (confirmations, reminders,
 *   missed-call and other follow-ups, AI text replies) are not sent.
 * - Quiet hours (default 9 PM–8 AM, the business's time zone): automated
 *   customer texts are queued and sent when the window ends.
 * - Manual texts the owner/staff send from the portal always go out.
 */
export const DEFAULT_QUIET_START = 21;
export const DEFAULT_QUIET_END = 8;

export interface TextingPrefs {
  textingEnabled: boolean;
  quietStartHour: number;
  quietEndHour: number;
  timeZone: string;
}

export type TextingDecision =
  | { action: "send" }
  | { action: "drop"; reason: "texting_off" }
  | { action: "queue"; sendAfter: Date };

function parts(at: Date, timeZone: string): { hour: number; minute: number } {
  const p = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "numeric", hourCycle: "h23" })
    .formatToParts(at);
  const n = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  return { hour: n("hour") % 24, minute: n("minute") };
}

/** Is `hour` (0–23) inside [start, end)? start > end crosses midnight; start == end means no quiet hours. */
export function inQuietHours(hour: number, start: number, end: number): boolean {
  if (start === end) return false;
  return start > end ? hour >= start || hour < end : hour >= start && hour < end;
}

/** The next moment the local clock reads `endHour`:00 in `timeZone`. */
export function nextLocalHour(now: Date, timeZone: string, endHour: number): Date {
  const step = 15 * 60_000;
  let t = new Date(Math.ceil(now.getTime() / step) * step);
  for (let i = 0; i < 4 * 26; i++, t = new Date(t.getTime() + step)) {
    const { hour, minute } = parts(t, timeZone);
    if (hour === endHour && minute < 15) return new Date(t.getTime() - minute * 60_000);
  }
  return new Date(now.getTime() + 12 * 3_600_000); // unreachable in practice
}

export function decideText(
  prefs: TextingPrefs,
  opts: { now: Date; manual?: boolean },
): TextingDecision {
  if (opts.manual) return { action: "send" };
  if (!prefs.textingEnabled) return { action: "drop", reason: "texting_off" };
  const { hour } = parts(opts.now, prefs.timeZone);
  if (inQuietHours(hour, prefs.quietStartHour, prefs.quietEndHour)) {
    return { action: "queue", sendAfter: nextLocalHour(opts.now, prefs.timeZone, prefs.quietEndHour) };
  }
  return { action: "send" };
}

export function hourLabel(h: number): string {
  const suffix = h < 12 ? "AM" : "PM";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return h === 0 ? "12 AM (midnight)" : h === 12 ? "12 PM (noon)" : `${twelve} ${suffix}`;
}
