/**
 * Quote follow-up texts: the pure half. No DB, no env, no vendor SDKs, so the
 * rules about WHO gets a text, WHEN and WHAT it says are unit-tested, and the
 * portal card can render the exact same preview the cron sends.
 *
 * What it does: a caller who asked for a quote, price or estimate and never
 * booked gets a short text about a day later, and a second one about a week
 * after the call. It stops the moment they book, reply, opt out or call back.
 *
 * Honesty rules:
 *  - Templated, never model-written. Calls are attacker-controlled input and
 *    these leave on the business's own number, unattended.
 *  - Nothing the caller said is copied into the text. The only variables are
 *    the caller's first name and the business name.
 *  - No prices, discounts or promises in the default wording.
 *
 * State lives in `clients.setup_flags.quoteFollowup` (no migration) and the
 * send ledger in `notifications` (payload.kind = QUOTE_FOLLOWUP_KIND).
 */
import { foldEs } from "@/lib/spanish-signals";

/** notifications.payload.kind for the per-person, per-step ledger rows. */
export const QUOTE_FOLLOWUP_KIND = "quote_followup";

/** sms_messages.kind on the outbound rows: `quote_followup_1` / `quote_followup_2`. */
export const QUOTE_FOLLOWUP_SMS_KIND = "quote_followup";

export type FollowupStep = 1 | 2;

/** Step 1 goes out once the call is at least this old… */
export const STEP1_MIN_HOURS = 24;
/** …and is dropped if the first chance to send it passes this (stale, or the toggle came on late). */
export const STEP1_MAX_HOURS = 72;
/** Step 2 goes out about a week after the call… */
export const STEP2_MIN_HOURS = 7 * 24;
/** …and is dropped after this. */
export const STEP2_MAX_HOURS = 10 * 24;
/** …and never sooner than this long after step 1, so two texts can't land back to back. */
export const STEP2_MIN_GAP_HOURS = 4 * 24;
/** How far back to look for qualifying calls at all. */
export const LOOKBACK_DAYS = 11;

/** Local hours (business time zone) in which a follow-up may go out: 9am up to 7pm. */
export const SEND_START_HOUR = 9;
export const SEND_END_HOUR = 19;

/** At most this many follow-up texts per business in one run / in a rolling 24 hours. */
export const MAX_PER_RUN = 15;
export const MAX_PER_DAY = 30;

/** Longest custom template, and longest text we'll ever send. */
export const MAX_TEMPLATE_CHARS = 300;
export const MAX_BODY_CHARS = 480;

export const OPT_OUT_EN = "Reply STOP to opt out.";
export const OPT_OUT_ES = "Responda STOP para no recibir más mensajes.";

// ---------------------------------------------------------------------------
// Settings (stored in setup_flags.quoteFollowup)
// ---------------------------------------------------------------------------

export interface QuoteFollowupSettings {
  enabled: boolean;
  /** ISO. When the owner (or operator) turned it on. */
  enabledAt?: string;
  /** Custom English wording. Empty/absent = the default below. */
  step1Template?: string;
  step2Template?: string;
}

/** Off unless someone turned it on. Anything malformed reads as off. */
export function parseSettings(flags: unknown): QuoteFollowupSettings {
  const raw = (flags as { quoteFollowup?: unknown } | null | undefined)?.quoteFollowup;
  if (!raw || typeof raw !== "object") return { enabled: false };
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);
  return {
    enabled: r.enabled === true,
    enabledAt: str(r.enabledAt),
    step1Template: str(r.step1Template),
    step2Template: str(r.step2Template),
  };
}

export function quoteFollowupEnabled(client: { setupFlags?: unknown }): boolean {
  return parseSettings(client.setupFlags).enabled;
}

// ---------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------

export const DEFAULT_TEMPLATES: Record<"en" | "es", Record<FollowupStep, string>> = {
  en: {
    1: "Hi {name}, it's {business}. You called about a quote. Still need one? Reply here and we'll get you set up.",
    2: "Hi {name}, {business} again. Just checking in on the quote you asked about. Want to pick a time? Reply here, or call us back.",
  },
  es: {
    1: "Hola {name}, le escribe {business}. Usted llamó para pedir una cotización. ¿Todavía la necesita? Responda aquí y lo coordinamos.",
    2: "Hola {name}, {business} otra vez. Solo queríamos saber si todavía le interesa la cotización que pidió. ¿Quiere agendar? Responda aquí o vuelva a llamarnos.",
  },
};

export type TextLang = "en" | "es";

function cleanOneLine(v: string | null | undefined, max: number): string {
  return (v ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** A caller's first name, or "" when we don't have a believable one (digits, too long). */
export function firstNameOf(name: string | null | undefined): string {
  const first = cleanOneLine(name, 60).split(" ")[0] ?? "";
  if (!first || /\d/.test(first) || first.length > 24) return "";
  return first;
}

function tidy(s: string): string {
  return s
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * The exact text for one step.
 *
 * - `{name}` is the caller's first name; with no name "Hi {name}," becomes "Hi,".
 * - `{business}` is the business name. A custom template that forgets it gets
 *   "<Business>: " in front, so every text says who it's from.
 * - The opt-out line is always last, added here so an edit can't remove it.
 * - Spanish callers get the standard Spanish wording (custom templates are English).
 */
export function renderFollowup(input: {
  step: FollowupStep;
  businessName: string;
  customerName?: string | null;
  language?: string | null;
  /** The owner's English template for this step, if any. */
  template?: string | null;
}): string {
  const lang: TextLang = input.language === "es" ? "es" : "en";
  const business = cleanOneLine(input.businessName, 60) || "our team";
  const name = firstNameOf(input.customerName);
  const custom = lang === "en" ? cleanOneLine(input.template, MAX_TEMPLATE_CHARS) : "";
  let template = custom || DEFAULT_TEMPLATES[lang][input.step];
  if (!/\{business\}/i.test(template)) template = `{business}: ${template}`;
  let body = template
    .replace(/\{business\}/gi, business)
    // "Hi {name}," with no name should read "Hi,", not "Hi ,".
    .replace(/\{name\}/gi, name);
  body = tidy(body);
  const optOut = lang === "es" ? OPT_OUT_ES : OPT_OUT_EN;
  // The carrier line must be there verbatim, so a template can't swap in its own wording.
  if (!body.includes(optOut)) body = `${body} ${optOut}`;
  return body.slice(0, MAX_BODY_CHARS);
}

/** What a saved template would be rejected for, or null if it's fine. Empty = use the default. */
export function templateProblem(template: string): string | null {
  const t = template.trim();
  if (!t) return null;
  if (t.length > MAX_TEMPLATE_CHARS) return `Keep each message under ${MAX_TEMPLATE_CHARS} characters.`;
  if (/https?:\/\/|www\./i.test(t)) return "Leave links out. Texts with links get blocked more often.";
  return null;
}

// ---------------------------------------------------------------------------
// Who asked for a quote
// ---------------------------------------------------------------------------

const QUOTE_EN =
  /\b(quote|quotes|quoted|quoting|estimate|estimates|estimated|price|prices|pricing|priced|how much|cost|costs|ballpark|rate|rates|what do you charge|what would it run)\b/i;
// Runs on foldEs() text (lowercase, no accents).
const QUOTE_ES =
  /\b(cotizacion|cotizaciones|cotizar|presupuesto|presupuestos|estimado|estimados|precio|precios|costo|costos|tarifa|tarifas|cuanto (cuesta|cuestan|cobran|cobra|sale|salen|seria|vale|valen|es)|cuanto me (cobran|cobra|costaria))\b/;

/** Only the caller's side of a transcript: the agent saying "pricing" isn't the caller asking. */
export function callerLines(transcript: string | null | undefined): string {
  return (transcript ?? "")
    .split(/\n+/)
    .filter((l) => /^\s*(user|caller|customer)\s*:/i.test(l))
    .join("\n");
}

export interface QuoteSignals {
  leadReason?: string | null;
  leadMessage?: string | null;
  leadService?: string | null;
  leadBudget?: string | null;
  summary?: string | null;
  transcript?: string | null;
  /** call_insights.entities.service, if extraction ran. */
  insightService?: string | null;
}

/**
 * Did this call show the caller wanted a quote, price or estimate?
 * Looks at what we stored: the captured lead, the call summary, and only the
 * caller's lines of the transcript. Anything we can't read counts as no.
 */
export function isQuoteRequest(s: QuoteSignals): boolean {
  const text = [s.leadReason, s.leadMessage, s.leadService, s.leadBudget, s.summary, s.insightService, callerLines(s.transcript)]
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .join("\n")
    .slice(0, 8000);
  if (!text) return false;
  return QUOTE_EN.test(text) || QUOTE_ES.test(foldEs(text));
}

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

/** Business-local hour (0-23) for `at`. Unknown zone → null, which callers treat as "don't send". */
export function localHour(at: Date, timeZone: string): number | null {
  try {
    const p = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).formatToParts(at);
    return Number(p.find((x) => x.type === "hour")?.value ?? NaN) % 24;
  } catch {
    return null;
  }
}

/** 9am up to (not including) 7pm in the business's own zone. */
export function withinSendHours(at: Date, timeZone: string): boolean {
  const h = localHour(at, timeZone);
  return h !== null && Number.isFinite(h) && h >= SEND_START_HOUR && h < SEND_END_HOUR;
}

const HOUR_MS = 3_600_000;

/**
 * Which step (if any) is due for a call, given when it happened and what has
 * already gone out. Pure timing only: the stop conditions are in `stopReason`.
 */
export function dueStep(input: {
  callAt: Date;
  now: Date;
  step1SentAt?: Date | null;
  step2SentAt?: Date | null;
}): FollowupStep | null {
  const age = (input.now.getTime() - input.callAt.getTime()) / HOUR_MS;
  if (age < 0) return null;
  if (!input.step1SentAt) {
    return age >= STEP1_MIN_HOURS && age <= STEP1_MAX_HOURS ? 1 : null;
  }
  if (input.step2SentAt) return null;
  const sinceStep1 = (input.now.getTime() - input.step1SentAt.getTime()) / HOUR_MS;
  if (sinceStep1 < STEP2_MIN_GAP_HOURS) return null;
  return age >= STEP2_MIN_HOURS && age <= STEP2_MAX_HOURS ? 2 : null;
}

// ---------------------------------------------------------------------------
// Stop conditions
// ---------------------------------------------------------------------------

export type StopReason =
  | "booked"
  | "has_upcoming"
  | "replied"
  | "called_back"
  | "lead_closed"
  | "owner_followed_up"
  | "blocked"
  | "opted_out"
  | "no_consent"
  | "no_phone";

export interface CandidateFacts {
  phone: string | null;
  /** An appointment (not cancelled) was made on the call, or for this number since it. */
  bookedSince: boolean;
  /** A not-cancelled appointment for this number is still ahead. */
  hasUpcoming: boolean;
  /** They texted back since the call (a real reply, not STOP). */
  repliedSince: boolean;
  /** They called again since the call. */
  calledBackSince: boolean;
  /** The owner marked the lead won or lost. */
  leadClosed: boolean;
  /** Someone else texted them about this since the call (owner by hand, recovery, text-back). */
  otherTextSince: boolean;
  blocked: boolean;
  optedOut: boolean;
  consented: boolean;
}

/** The first reason NOT to text this person, or null when they're fine to text. */
export function stopReason(f: CandidateFacts): StopReason | null {
  if (!f.phone) return "no_phone";
  if (f.blocked) return "blocked";
  if (f.optedOut) return "opted_out";
  if (f.bookedSince) return "booked";
  if (f.hasUpcoming) return "has_upcoming";
  if (f.repliedSince) return "replied";
  if (f.calledBackSince) return "called_back";
  if (f.leadClosed) return "lead_closed";
  if (f.otherTextSince) return "owner_followed_up";
  if (!f.consented) return "no_consent";
  return null;
}

/** The phone key every comparison uses: last ten digits. */
export function phoneKey(raw: string | null | undefined): string | null {
  const d = (raw ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
}

// ---------------------------------------------------------------------------
// Plain-words status
// ---------------------------------------------------------------------------

/** Why nothing can send for a business right now, in words an owner can act on. */
export function gateMessage(gate: string | null | undefined): string | null {
  switch (gate) {
    case null:
    case undefined:
      return null;
    case "deleted":
    case "suspended":
    case "not_active":
      return "This company isn't active, so nothing is sent.";
    case "trial_ended":
      return "The free trial has ended, so texts are paused until there's a plan.";
    case "payment_hold":
      return "Billing is on hold, so texts are paused.";
    case "texting_not_approved":
      return "Business texting isn't approved yet. Nothing will send until it is.";
    case "no_texting_number":
      return "This business doesn't have its own texting number yet. Nothing will send until it does.";
    default:
      return "Nothing can send right now.";
  }
}
