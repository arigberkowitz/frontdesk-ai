import { DAYS } from "@/config/options";
import { formatCurrencyCents } from "./format";

/**
 * Builds the Retell LLM `general_prompt` from a client's profile, services,
 * hours, and FAQ (PRD §9.3). Pure (no DB / no server-only) so it's unit-testable
 * and reusable by provisioning and the agent-versions snapshot.
 */
export interface PromptClient {
  name: string;
  industry?: string | null;
  address?: string | null;
  timezone: string;
  escalationNumber?: string | null;
  recordingDisclosureEnabled: boolean;
  recordingDisclosureLine?: string | null;
  /** Company-authored guardrails: what the assistant may and may not say. */
  guidance?: string | null;
  /** Company-authored rules for how the assistant should book. */
  bookingInstructions?: string | null;
  /** "Human touch": proactively offer a real person, not just on request. */
  humanHandoffEnabled?: boolean;
  /** Freeform note on when a human is actually reachable, e.g. "weekdays 9–5". */
  humanHoursNote?: string | null;
  /** Spoken languages: 'en' | 'en-es' (bilingual) | 'es'. */
  languages?: string | null;
  /** Whether a calendar is connected so the agent can actually book. When false,
   *  the agent must not promise booking — it takes a message to schedule instead. */
  bookingEnabled?: boolean;
}

/** The agent's language instruction for the prompt, by setting. */
function languageRule(languages: string | null | undefined): string | null {
  switch (languages) {
    case "en-es":
      return "You are fully bilingual in English and Spanish. Open in English, but the moment a caller speaks Spanish or asks for Spanish, switch and continue the entire call in natural, fluent Spanish — and switch back if they do. Always match the caller's language.";
    case "es":
      return "Habla con las personas que llaman en español de forma natural y fluida por defecto. Si la persona prefiere inglés, cambia al inglés. (Speak with callers in fluent, natural Spanish by default; switch to English if the caller prefers.)";
    default:
      return null; // English-only: no special instruction needed.
  }
}
export interface PromptService {
  name: string;
  durationMin: number;
  priceCents?: number | null;
  description?: string | null;
  isActive: boolean;
}
export interface PromptHours {
  dayOfWeek: number;
  isClosed: boolean;
  openTime?: string | null;
  closeTime?: string | null;
}
export interface PromptKnowledge {
  question: string;
  answer: string;
  isActive: boolean;
}

export interface BuildPromptInput {
  agentName: string;
  client: PromptClient;
  services: PromptService[];
  hours: PromptHours[];
  knowledge: PromptKnowledge[];
  /** Staff mode: active team member names the caller can ask for. */
  staffNames?: string[];
}

export const DEFAULT_AGENT_NAME = "Riley";

function hoursBlock(hours: PromptHours[]): string {
  if (!hours.length) return "Hours are not specified — if asked, offer to take a message.";
  const byDay = new Map(hours.map((h) => [h.dayOfWeek, h]));
  return DAYS.map(({ value, label }) => {
    const h = byDay.get(value);
    if (!h || h.isClosed || !h.openTime || !h.closeTime) return `${label}: Closed`;
    return `${label}: ${h.openTime}–${h.closeTime}`;
  }).join("\n");
}

function servicesBlock(services: PromptService[]): string {
  const active = services.filter((s) => s.isActive);
  if (!active.length) return "No bookable services configured yet.";
  return active
    .map((s) => {
      const price = s.priceCents != null ? ` — ${formatCurrencyCents(s.priceCents)}` : "";
      const dur = ` (${s.durationMin} min)`;
      const desc = s.description ? ` — ${s.description}` : "";
      return `- ${s.name}${dur}${price}${desc}`;
    })
    .join("\n");
}

function knowledgeBlock(knowledge: PromptKnowledge[]): string {
  const active = knowledge.filter((k) => k.isActive);
  if (!active.length) return "No FAQ entries yet. If unsure, take a message — never guess.";
  return active.map((k) => `Q: ${k.question}\nA: ${k.answer}`).join("\n\n");
}

export function defaultGreeting(client: { name: string }, agentName = DEFAULT_AGENT_NAME): string {
  return `Hi, thanks for calling ${client.name}! This is ${agentName}, the AI assistant. How can I help you today?`;
}

export function resolveDisclosureLine(client: PromptClient): string | null {
  if (!client.recordingDisclosureEnabled) return null;
  const line = client.recordingDisclosureLine?.trim();
  return line && line.length
    ? line
    : `Just so you know, I'm an AI assistant for ${client.name} and this call may be recorded.`;
}

export function buildGeneralPrompt(input: BuildPromptInput): string {
  const { client, agentName, services, hours, knowledge, staffNames } = input;
  const team = (staffNames ?? []).filter((n) => n.trim());
  const location = client.address?.trim() ? ` in ${client.address.trim()}` : "";
  const industry = client.industry?.trim() ? `${client.industry.trim()} ` : "";
  const disclosure = resolveDisclosureLine(client);
  const guidance = client.guidance?.trim();
  const bookingInstructions = client.bookingInstructions?.trim();
  const handoff = client.humanHandoffEnabled !== false; // default on
  const humanHours = client.humanHoursNote?.trim();
  const language = languageRule(client.languages);
  const canBook = client.bookingEnabled !== false; // default on (preserves prior behavior)

  const rules = [
    language,
    // Voice-call pacing: stacked questions overwhelm callers. One at a time.
    "Ask for ONE piece of information at a time and wait for the answer — never bundle questions (\"your name?\" … then \"best number to reach you?\" … then \"when works for you?\"). Briefly acknowledge or confirm each answer (especially phone numbers, read them back) before asking the next.",
    disclosure ? `At the start of the call, naturally disclose: "${disclosure}"` : null,
    guidance
      ? `Follow the "What ${client.name} wants you to say" section above EXACTLY — those instructions take priority over these rules wherever they conflict.`
      : null,
    team.length > 0
      ? `The team: ${team.join(", ")}. When booking, ask if the caller would like anyone in particular (pass their answer as "person" when booking); if they have no preference, book with whoever is free and tell them who they'll be seeing.`
      : null,
    "Answer questions using the knowledge below and the business's instructions. If something isn't covered, say you'll have someone follow up — never invent prices, policies, or medical/legal advice.",
    canBook
      ? "Book using the booking tools, following the booking instructions below. Always confirm service, date/time, name, and phone before booking."
      : "You CANNOT book appointments directly — there's no live calendar. Never offer to book or claim something is scheduled. Instead, take a message with their name, phone, and what they'd like to schedule, and tell them the team will call back to set a time.",
    canBook
      ? "If booking isn't possible or the caller isn't ready, use take_message to capture name, phone, and reason — and, when it comes up naturally, what they need (service), how soon (urgency), and any budget, so the team can prioritize the callback."
      : "Use take_message to capture name, phone, and reason — and, when it comes up naturally, what they need (service), how soon (urgency), and any budget, so the team can prioritize the callback.",
    "If the caller asks for a person, says 'agent' or 'representative', presses 0, or wants a human, use transfer_to_human to connect them to the team.",
    handoff
      ? `Don't wait to be asked: if the caller sounds upset, frustrated, confused, or has a sensitive or complex matter, proactively offer to connect them to a real person${
          humanHours ? ` (a person is usually reachable ${humanHours})` : ""
        } — "Would you like me to connect you with someone on the team?"`
      : null,
    "If a transfer doesn't go through (no one's available), apologize briefly — \"Sorry, they're not free right now, but I can take your name and number and have someone call you right back\" — capture the name and phone with take_message, and keep helping the caller yourself; never just hang up.",
    "Never promise outcomes. Never give medical, legal, or financial advice.",
    "Always collect a callback number before ending if anything is unresolved, and promise a real person will follow up.",
  ].filter(Boolean);

  const bookingBlock = !canBook
    ? "There is no connected calendar, so you cannot book. If a caller wants an appointment, take a message (name, phone, service, and preferred times) and tell them someone will call back to schedule. Do not use the booking tools."
    : bookingInstructions ||
      "Use check_availability to find open times, then book_appointment. Confirm the service, date/time, name, and phone before booking, and read the appointment back to the caller.";

  const capabilities = [
    "- Answer questions from the knowledge base below.",
    canBook
      ? "- Book appointments using the booking tools (check_availability, then book_appointment)."
      : "- Take a message to schedule (no live calendar) — capture name, phone, and preferred times; the team calls back to confirm.",
    "- Take a message (take_message) capturing name + phone + reason.",
    "- Transfer to a human (transfer_to_human) on request or for sensitive matters.",
  ].join("\n");

  return `You are ${agentName}, the friendly AI receptionist for ${client.name}, a ${industry}business${location}.

# Identity & tone
Warm, concise, professional. Speak naturally, never robotic. Keep replies short and conversational.
${
  guidance
    ? `
# What ${client.name} wants you to say (follow this exactly — highest priority)
${guidance}
`
    : ""
}
# What you can do
${capabilities}

# Hours (timezone: ${client.timezone})
${hoursBlock(hours)}

# Services
${servicesBlock(services)}

# How to handle booking
${bookingBlock}

# Knowledge / FAQ
${knowledgeBlock(knowledge)}

# Rules
${rules.map((r) => `- ${r}`).join("\n")}`;
}
