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

/**
 * Appointment texts never contain a phone number. Product decision (Ari,
 * 2026-09-30): the confirmation used to end "Need to change it? Call
 * <escalation number>", and the escalation number is the business's
 * transfer/alert number — often somebody's personal mobile (on the demo
 * business it was a family member's cell). A customer-facing text is the wrong
 * place for it, and there's no number we can be sure is right to print. So
 * there is no phone parameter at all, and any phone-like digit run that
 * sneaks in through a name/service/business field (e.g. a spoken name that
 * was really a number) is removed.
 */
const PHONE_LIKE = /\+?\(?\d[\d\s().-]{5,}\d/g;

export function stripPhoneNumbers(text: string | null | undefined): string {
  return (text ?? "")
    .replace(PHONE_LIKE, (m) => (m.replace(/\D/g, "").length >= 7 ? "" : m))
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function firstName(name: string | null): string {
  const first = stripPhoneNumbers(name).split(/\s+/)[0];
  return first ? ` ${first}` : "";
}

/**
 * Which template language to use for a customer. Only Spanish has
 * hand-written templates. Every other language, or an unknown one, gets
 * English, the text every customer received before.
 */
export function textLanguage(language: string | null | undefined): "en" | "es" {
  return language === "es" ? "es" : "en";
}

/** The appointment time, in the text's language and the business's timezone. */
export function formatWhen(at: Date, timeZone: string, language?: string | null): string {
  return new Intl.DateTimeFormat(textLanguage(language) === "es" ? "es-US" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(at);
}

export function confirmationText(opts: {
  business: string;
  customerName: string | null;
  serviceName?: string | null;
  when: string;
  meetingUrl?: string | null;
  /** The customer's language code, when known. */
  language?: string | null;
}): string {
  const business = stripPhoneNumbers(opts.business);
  const serviceName = stripPhoneNumbers(opts.serviceName);
  if (textLanguage(opts.language) === "es") {
    // STOP stays in English: it's the carrier's opt-out keyword.
    return (
      `Hola${firstName(opts.customerName)}, su cita con ${business} está confirmada: ${serviceName ? `${serviceName}, ` : ""}${opts.when}.` +
      (opts.meetingUrl ? ` Únase por video: ${opts.meetingUrl}` : "") +
      ` ¿Necesita cambiarla? Llame a ${business}.` +
      ` Responda STOP para no recibir más mensajes.`
    );
  }
  const service = serviceName ? `${serviceName} ` : "";
  return (
    `Hi${firstName(opts.customerName)}, you're booked with ${business} — ${service}on ${opts.when}.` +
    (opts.meetingUrl ? ` Join by video: ${opts.meetingUrl}` : "") +
    ` Need to change it? Give ${business} a call.` +
    ` Reply STOP to opt out.`
  );
}

export function reminderText(opts: {
  business: string;
  customerName: string | null;
  when: string;
  meetingUrl?: string | null;
  /** The customer's language code, when known. */
  language?: string | null;
}): string {
  const business = stripPhoneNumbers(opts.business);
  if (textLanguage(opts.language) === "es") {
    return (
      `Hola${firstName(opts.customerName)}, le recordamos su cita con ${business}: ${opts.when}.` +
      (opts.meetingUrl ? ` Únase por video: ${opts.meetingUrl}` : "") +
      ` ¿Necesita cambiarla? Llame a ${business}.` +
      ` Responda STOP para no recibir más mensajes.`
    );
  }
  return (
    `Hi${firstName(opts.customerName)}, a reminder of your appointment with ${business} ${opts.when}.` +
    (opts.meetingUrl ? ` Join by video: ${opts.meetingUrl}` : "") +
    ` Need to reschedule? Give ${business} a call.` +
    ` Reply STOP to opt out.`
  );
}
