import { BASE_GUARDRAILS, packForIndustry, STARTER_PACKS } from "@/config/starter-packs";
import { DEFAULT_AGENT_NAME } from "@/lib/prompt";
import { languageNames } from "@/lib/languages";

/**
 * "Fill in for me": starting text for the setup boxes (greeting, what the AI
 * may say, booking rules, a service's description), written from what the
 * business has already told us — its kind of business, services, hours, whether
 * a calendar is connected, languages and how handoff to a person is set up.
 *
 * Deterministic on purpose. The same facts always give the same text, nothing
 * here can fail or cost money, and nothing is invented: no prices, deposits,
 * guarantees or policies. Where a fact is missing we leave the sentence out
 * rather than leave a `[placeholder]` in text the AI would read out loud.
 * The owner edits the result and it is saved only when they press Save.
 *
 * Pure (no DB, no server-only) so it is easy to test. The server action in
 * `lib/actions/setup-draft.ts` gathers the facts.
 */

export const DRAFT_FIELDS = [
  "greeting",
  "agentGuidance",
  "bookingInstructions",
  "serviceDescription",
] as const;
export type DraftField = (typeof DRAFT_FIELDS)[number];

export function isDraftField(v: unknown): v is DraftField {
  return typeof v === "string" && (DRAFT_FIELDS as readonly string[]).includes(v);
}

export interface DraftFacts {
  businessName: string;
  agentName?: string | null;
  industry: string | null;
  /** Active services only. */
  services: { name: string; priceCents: number | null }[];
  hours: {
    dayOfWeek: number;
    isClosed: boolean;
    openTime: string | null;
    closeTime: string | null;
  }[];
  calendarConnected: boolean;
  /** Language codes, primary first (see `parseLanguages`). */
  languages: string[];
  /** A transfer number is set, so a call can be put through to a person. */
  canTransfer: boolean;
  handoffMode: "always" | "open_hours" | "never";
  humanHandoffEnabled: boolean;
}

// ─── small helpers ─────────────────────────────────────────────────────────

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
/** Monday-first reads naturally for business hours. */
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

/** "09:00" → "9 AM", "17:30" → "5:30 PM". Anything unparseable → null. */
export function formatClock(hhmm: string | null | undefined): string | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm ?? "");
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2];
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return min === "00" ? `${h12} ${suffix}` : `${h12}:${min} ${suffix}`;
}

/**
 * "Mon–Fri 9 AM–5 PM; Sat 9 AM–2 PM". Runs of consecutive days with the same
 * hours are joined; closed days are left out. Null when nothing is open.
 */
export function summarizeHours(hours: DraftFacts["hours"]): string | null {
  const byDay = new Map<number, string>();
  for (const h of hours) {
    if (h.isClosed) continue;
    const open = formatClock(h.openTime);
    const close = formatClock(h.closeTime);
    if (open && close) byDay.set(h.dayOfWeek, `${open}–${close}`);
  }
  const parts: string[] = [];
  let i = 0;
  while (i < DAY_ORDER.length) {
    const range = byDay.get(DAY_ORDER[i]);
    if (!range) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < DAY_ORDER.length && byDay.get(DAY_ORDER[j + 1]) === range) j++;
    const first = DAY_SHORT[DAY_ORDER[i]];
    const last = DAY_SHORT[DAY_ORDER[j]];
    parts.push(`${j - i >= 1 ? `${first}–${last}` : first} ${range}`);
    i = j + 1;
  }
  return parts.length ? parts.join("; ") : null;
}

/** "A, B and C", capped so a long menu doesn't become a wall of text. */
function listNames(names: string[], cap = 6): string {
  const shown = names.slice(0, cap);
  const more = names.length - shown.length;
  const list =
    shown.length <= 1
      ? (shown[0] ?? "")
      : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
  return more > 0 ? `${list}, and ${more} more` : list;
}

/** Sentence split that is safe for our own pack text ("911." stays attached). */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const bullet = (s: string) => `• ${s}`;

// ─── per-field builders ────────────────────────────────────────────────────

const GREETING_ASK: Record<string, string> = {
  Dental: "Are you calling to schedule a visit, or do you have a question?",
  Chiropractic: "Are you calling to schedule a visit, or do you have a question?",
  Veterinary: "Are you calling to book a visit for your pet, or do you have a question?",
  "Salon & beauty": "Are you looking to book an appointment?",
  "Med spa": "Are you looking to book an appointment?",
  Fitness: "Are you looking to book a session?",
  Law: "How can I help you today?",
  "Auto repair": "What can we help you with on your vehicle today?",
  HVAC: "What can we help you with today?",
  Plumbing: "What can we help you with today?",
  Electrician: "What can we help you with today?",
  Locksmith: "What can we help you with today?",
  "Home services": "What can we help you with today?",
};

function buildGreeting(f: DraftFacts): string {
  const agent = f.agentName?.trim() || DEFAULT_AGENT_NAME;
  const name = f.businessName.trim();
  if (f.languages[0] === "es") {
    return `¡Hola, gracias por llamar a ${name}! Soy ${agent}, el asistente de inteligencia artificial. ¿En qué le puedo ayudar?`;
  }
  const ask = (f.industry && GREETING_ASK[f.industry]) || "How can I help you today?";
  // Says it is an AI up front, as every greeting must. The recording notice is
  // added by the system when it's switched on, so it isn't repeated here.
  return `Thanks for calling ${name}. This is ${agent}, the AI assistant. ${ask}`;
}

function buildGuidance(f: DraftFacts): string {
  const pack = packForIndustry(f.industry);
  // The pack's guardrails open with a generic paragraph; we write our own
  // opening below and keep the part that is specific to this kind of business.
  const specific = pack.guardrails.startsWith(BASE_GUARDRAILS)
    ? pack.guardrails.slice(BASE_GUARDRAILS.length).trim()
    : pack.guardrails;

  const lines: string[] = [
    "Be warm, polite and professional.",
    "Only use what's in your profile. If you're not sure about a price, availability or a policy, take a message and have someone follow up. Never make up details.",
  ];

  if (f.services.length) {
    lines.push(`You can talk about these services: ${listNames(f.services.map((s) => s.name))}.`);
  }
  const hasPrices = f.services.some((s) => s.priceCents != null);
  lines.push(
    hasPrices
      ? "Only quote a price that's listed with the service. For anything else, say the team will confirm the price."
      : "Don't quote prices. Say the team will confirm the price.",
  );

  lines.push(...sentences(specific));

  if (f.languages.length > 1) {
    lines.push(`Speak ${languageNames(f.languages)}, whichever the caller uses.`);
  }

  const canConnect = f.canTransfer && f.humanHandoffEnabled && f.handoffMode !== "never";
  if (canConnect) {
    lines.push(
      f.handoffMode === "open_hours"
        ? "If someone asks for a real person while the office is open, offer to connect them. Otherwise take a message."
        : "If someone asks for a real person, offer to connect them to the team.",
    );
  } else {
    lines.push("If someone asks for a real person, take a message and say the team will call back.");
  }

  return unique(lines).map(bullet).join("\n");
}

function buildBooking(f: DraftFacts): string {
  const pack = packForIndustry(f.industry);
  const lines: string[] = [];

  if (f.services.length) {
    lines.push(
      `Book these services: ${listNames(f.services.map((s) => s.name), 8)}. For anything else, take a message.`,
    );
  }

  const hours = summarizeHours(f.hours);
  if (hours) lines.push(`Only offer times when we're open (${hours}).`);

  if (f.calendarConnected) {
    lines.push("Offer the next open times on the calendar.");
  } else {
    lines.push(
      "The calendar isn't connected yet, so don't promise a time. Take the caller's name, number and the day and time they'd like, and say the team will confirm.",
    );
  }

  // The industry's own steps (what to collect, what to read back). The generic
  // "offer the next openings" sentence is replaced by the calendar line above.
  lines.push(...sentences(pack.booking).filter((s) => !/^Offer the next available/i.test(s)));

  if (f.languages.length > 1) {
    lines.push("Read the booking back in the language the caller is using.");
  }

  return unique(lines).map(bullet).join("\n");
}

/**
 * A service's description: the starter text for a service of the same name
 * (so "Teeth whitening" gets the dental whitening text), otherwise nothing.
 * Descriptions are what the AI says about a service, so a vague guess would
 * be worse than a blank.
 */
export function serviceDescriptionFor(
  industry: string | null,
  serviceName: string,
): string | null {
  const want = normalizeName(serviceName);
  if (!want) return null;
  const industryPack = packForIndustry(industry);
  // The business's own kind first, then any other kind's service of that name
  // (a plumber adding "Estimate" should get the estimate text).
  const packs = [industryPack, ...STARTER_PACKS.filter((p) => p !== industryPack)];
  for (const p of packs) {
    const hit = p.services.find((s) => normalizeName(s.name) === want);
    if (hit) return hit.description;
  }
  return null;
}

const normalizeName = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function unique(lines: string[]): string[] {
  return lines.filter((l, i) => lines.indexOf(l) === i);
}

// ─── public entry ──────────────────────────────────────────────────────────

export interface DraftResult {
  ok: true;
  text: string;
  /** Plain-words reminder of what was NOT filled in, shown under the box. */
  note: string;
}
export interface DraftMiss {
  ok: false;
  error: string;
}

const NOTES: Record<DraftField, string> = {
  greeting:
    "Edit it so it sounds like you. We add the AI and recording notice for you if it's missing.",
  agentGuidance:
    "We left out prices, guarantees and policies. Add any you want your AI to say.",
  bookingInstructions:
    "We left out deposits and prices. Add any you want your AI to mention.",
  serviceDescription: "Check it matches how you do this service.",
};

export function buildDraft(
  field: DraftField,
  facts: DraftFacts,
  opts: { serviceName?: string } = {},
): DraftResult | DraftMiss {
  let text: string | null;
  switch (field) {
    case "greeting":
      text = buildGreeting(facts);
      break;
    case "agentGuidance":
      text = buildGuidance(facts);
      break;
    case "bookingInstructions":
      text = buildBooking(facts);
      break;
    case "serviceDescription":
      text = serviceDescriptionFor(facts.industry, opts.serviceName ?? "");
      if (!text) {
        return {
          ok: false,
          error: opts.serviceName?.trim()
            ? "We don't have a starting description for that service. Write a sentence on what's included."
            : "Type the service name first, then try again.",
        };
      }
      break;
  }
  // The save forms cap these boxes (validation.ts); a draft must always fit.
  const max = field === "greeting" ? 1000 : field === "serviceDescription" ? 1000 : 4000;
  return { ok: true, text: text.slice(0, max), note: NOTES[field] };
}
