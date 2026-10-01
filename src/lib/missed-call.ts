/**
 * Missed/dropped-call text-back — the pure rules. No I/O here, so every
 * decision about WHO gets a text and WHAT it says is unit-tested.
 *
 * Deliberately templated, never model-written: this text goes to someone who
 * may never have spoken to the business, so its wording is fixed, short, and
 * reviewable. Nothing the caller said is ever copied into it — the only
 * variable parts are the business's own name and (optionally) the name of one
 * of the business's own services, matched exactly.
 */
import { stripPhoneNumbers } from "@/lib/appointment-messages";
import { matchService } from "@/lib/service-match";

export type CallbackReason = "hung_up_early" | "dropped" | "abandoned_booking";

/** A call shorter than this that the caller ended counts as a hang-up before we could help. */
export const EARLY_HANGUP_SECONDS = 25;
/** Never text the same number twice in this window, whatever happens. */
export const DEDUPE_DAYS = 7;
/** Per-business ceiling on callback texts/calls in a rolling 24h. */
export const MAX_CALLBACKS_PER_CLIENT_PER_DAY = 25;
/** A "sorry we got cut off" more than this long after the call is stale; drop it. */
export const MAX_CALL_AGE_HOURS = 20;

/** Retell `disconnection_reason` values that mean the line failed, not a person. */
const DROPPED_REASONS = new Set([
  "concurrency_limit_reached",
  "registered_call_timeout",
  "dial_failed",
  "scam_detected", // listed so it's explicit: handled as spam below, never "dropped"
]);
const SPAM_INTENTS = new Set(["spam", "vendor_or_sales", "wrong_number"]);
const BOOKING_INTENTS = new Set(["book_appointment", "reschedule"]);
/** Transcript evidence the caller was trying to book, when extraction didn't run or said "other". */
const BOOKING_WORDS =
  /\b(book|booking|appointment|schedule|reschedule|availability|available|opening|openings|slot|come in)\b/i;

export interface CallFacts {
  direction: string | null;
  outcome: string | null;
  durationSec: number | null;
  disconnectionReason: string | null;
  transcript: string | null;
  /** From call_insights (Agent #2), when it ran. */
  intent: string | null;
  isSpam: boolean;
  callerBlocked: boolean;
  /** An appointment was created on this call. */
  bookedOnCall: boolean;
  /** A lead/message was captured on this call — the owner already has it. */
  leadOnCall: boolean;
}

export type Classification = { ok: true; reason: CallbackReason } | { ok: false; skip: string };

function hadBookingIntent(f: CallFacts): boolean {
  if (f.intent && BOOKING_INTENTS.has(f.intent)) return true;
  if (f.intent && f.intent !== "other") return false; // a question/cancel/complaint, not a booking
  return BOOKING_WORDS.test(callerLines(f.transcript ?? ""));
}

/** Only what the CALLER said — the agent offering "would you like to book?" isn't intent. */
function callerLines(transcript: string): string {
  return transcript
    .split(/\n+/)
    .filter((l) => /^\s*(user|caller|customer)\s*:/i.test(l))
    .join("\n");
}

/** Decide whether this ended call deserves a "want to finish booking?" text, and why. */
export function classifyCall(f: CallFacts): Classification {
  if (f.direction === "outbound") return { ok: false, skip: "outbound_call" };
  if (f.callerBlocked || f.isSpam || f.outcome === "spam") return { ok: false, skip: "spam" };
  if (f.intent && SPAM_INTENTS.has(f.intent)) return { ok: false, skip: "spam" };
  if (f.bookedOnCall || f.outcome === "booked") return { ok: false, skip: "booked" };
  if (f.outcome === "escalated") return { ok: false, skip: "transferred" };
  if (f.leadOnCall || f.outcome === "lead") return { ok: false, skip: "message_taken" };

  const reason = (f.disconnectionReason ?? "").toLowerCase();
  if (!reason) return { ok: false, skip: "unknown_end" };
  if (reason === "scam_detected") return { ok: false, skip: "spam" };
  if (reason === "call_transfer") return { ok: false, skip: "transferred" };
  if (reason === "voicemail_reached" || reason === "machine_detected") {
    return { ok: false, skip: "voicemail" };
  }
  if (reason.startsWith("error") || DROPPED_REASONS.has(reason)) {
    return { ok: true, reason: "dropped" };
  }
  if (reason === "user_hangup" || reason === "inactivity" || reason === "max_duration_reached") {
    if (hadBookingIntent(f)) return { ok: true, reason: "abandoned_booking" };
    if (reason === "user_hangup" && f.durationSec != null && f.durationSec < EARLY_HANGUP_SECONDS) {
      return { ok: true, reason: "hung_up_early" };
    }
    return { ok: false, skip: "completed" };
  }
  // agent_hangup and anything else: the conversation ended normally.
  return { ok: false, skip: "completed" };
}

/** US numbers only: our sending numbers are US 10DLC/toll-free. */
export function textablePhone(e164: string | null | undefined): string | null {
  return e164 && /^\+1\d{10}$/.test(e164) ? e164 : null;
}

/** The business's own service name, only when the caller's words match one exactly. */
export function serviceFor(
  spoken: unknown,
  services: { name: string; isActive?: boolean | null }[],
): string | null {
  if (typeof spoken !== "string" || !spoken.trim()) return null;
  const m = matchService(spoken.slice(0, 80), services);
  return m.kind === "exact" ? m.service.name : null;
}

function clean(name: string): string {
  return stripPhoneNumbers(name).replace(/\s+/g, " ").trim().slice(0, 60) || "Us";
}

/** The text. Fixed wording; ends with opt-out language like every automated text. */
export function callbackText(input: {
  businessName: string;
  reason: CallbackReason;
  serviceName?: string | null;
}): string {
  const name = clean(input.businessName);
  const service = input.serviceName ? clean(input.serviceName).toLowerCase() : null;
  const ask = "Just reply here with a day and time that works and we'll get you booked.";
  const opener =
    input.reason === "dropped"
      ? "Sorry, it looks like our call got cut off."
      : input.reason === "abandoned_booking"
        ? `Looks like we didn't get to finish booking your ${service ?? "appointment"}.`
        : "Sorry we missed you on the phone!";
  return `${name}: ${opener} ${ask} Reply STOP to opt out.`;
}

/** What the AI says first when it phones back (disclosure is added by the caller of this). */
export function callbackOpener(input: {
  agentName: string | null;
  businessName: string;
  reason: CallbackReason;
}): string {
  const who = input.agentName?.trim() || "the assistant";
  const why =
    input.reason === "dropped"
      ? "it looks like our call got cut off earlier"
      : "it looks like we didn't get to finish earlier";
  return `Hi, this is ${who}, the AI assistant for ${input.businessName}, calling back — ${why}. Did you still want to book something?`;
}

/** When a callback can no longer be useful. */
export function isStale(callStartedAt: Date, now: Date): boolean {
  return now.getTime() - callStartedAt.getTime() > MAX_CALL_AGE_HOURS * 3_600_000;
}
