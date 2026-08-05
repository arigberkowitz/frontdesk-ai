/**
 * The two texts a customer should actually get: "you're booked", and a nudge
 * the day before.
 *
 * Until now neither existed. The agent asks every caller "would you like me to
 * text you the confirmation and a reminder?", the caller says yes, and nothing
 * was ever sent — a promise made on a recorded line and quietly broken. That's
 * worse than never offering, and it's the same class of failure as a transfer
 * that rings out.
 *
 * Pure and client-safe: the wording and the "is this one due?" rule are the
 * parts worth arguing about in a test.
 */

export interface ReminderCandidate {
  id: string;
  startAt: Date;
  customerPhone: string | null;
  customerName: string | null;
  status: string;
  /** How many texts we've already sent about this appointment. */
  textsAlreadySent: number;
}

/** Local hours we're willing to text a customer. Nobody wants 6am. */
export const QUIET_BEFORE_HOUR = 9;
export const QUIET_AFTER_HOUR = 20;

export function withinTextingHours(now: Date, timeZone: string): boolean {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", hour12: false }).format(now),
  );
  const h = hour === 24 ? 0 : hour;
  return h >= QUIET_BEFORE_HOUR && h < QUIET_AFTER_HOUR;
}

/**
 * Which appointments are due a day-before reminder right now.
 *
 * The window is deliberately wide (12–36 hours out) because this runs once a
 * day: an appointment at 9am tomorrow and one at 6pm tomorrow should both get
 * exactly one nudge from the same sweep.
 *
 * `textsAlreadySent` is the guard, and it counts every text about this
 * appointment — including one the owner sent by hand. Someone who has already
 * been contacted about tomorrow doesn't need us doing it again.
 */
export function dueForReminder(
  candidates: ReminderCandidate[],
  nowMs: number,
  minHours = 12,
  maxHours = 36,
): ReminderCandidate[] {
  const HOUR = 3_600_000;
  return candidates.filter((a) => {
    if (a.status === "cancelled" || a.status === "no_show") return false;
    if (!a.customerPhone) return false;
    // Exactly one prior text — the booking confirmation. Zero means they never
    // consented, so we have no permission to start now.
    if (a.textsAlreadySent !== 1) return false;
    const hoursAway = (a.startAt.getTime() - nowMs) / HOUR;
    return hoursAway >= minHours && hoursAway <= maxHours;
  });
}

function firstName(name: string | null): string {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first ? ` ${first}` : "";
}

export function confirmationText(opts: {
  business: string;
  customerName: string | null;
  serviceName?: string | null;
  when: string;
  callbackNumber?: string | null;
  meetingUrl?: string | null;
}): string {
  const service = opts.serviceName ? `${opts.serviceName} ` : "";
  return (
    `Hi${firstName(opts.customerName)}, you're booked with ${opts.business} — ${service}on ${opts.when}.` +
    (opts.meetingUrl ? ` Join by video: ${opts.meetingUrl}` : "") +
    (opts.callbackNumber ? ` Need to change it? Call ${opts.callbackNumber}.` : "") +
    ` Reply STOP to opt out.`
  );
}

export function reminderText(opts: {
  business: string;
  customerName: string | null;
  when: string;
  callbackNumber?: string | null;
  meetingUrl?: string | null;
}): string {
  return (
    `Hi${firstName(opts.customerName)}, a reminder of your appointment with ${opts.business} ${opts.when}.` +
    (opts.meetingUrl ? ` Join by video: ${opts.meetingUrl}` : "") +
    (opts.callbackNumber ? ` Need to reschedule? Call ${opts.callbackNumber}.` : "") +
    ` Reply STOP to opt out.`
  );
}
