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
  const { client, agentName, services, hours, knowledge } = input;
  const location = client.address?.trim() ? ` in ${client.address.trim()}` : "";
  const industry = client.industry?.trim() ? `${client.industry.trim()} ` : "";
  const disclosure = resolveDisclosureLine(client);
  const guidance = client.guidance?.trim();
  const bookingInstructions = client.bookingInstructions?.trim();

  const rules = [
    disclosure ? `At the start of the call, naturally disclose: "${disclosure}"` : null,
    guidance
      ? `Follow the "What ${client.name} wants you to say" section above EXACTLY — those instructions take priority over these rules wherever they conflict.`
      : null,
    "Answer questions using the knowledge below and the business's instructions. If something isn't covered, say you'll have someone follow up — never invent prices, policies, or medical/legal advice.",
    "Book using the booking tools, following the booking instructions below. Always confirm service, date/time, name, and phone before booking.",
    "If booking isn't possible or the caller isn't ready, use take_message to capture name, phone, and reason.",
    "If the caller asks for a person, says 'agent' or 'representative', presses 0, or wants a human, use transfer_to_human to connect them to the team.",
    "If a transfer doesn't go through (no one's available), apologize briefly — \"Sorry, they're not free right now, but I can help you with whatever you need\" — and keep helping the caller yourself; never just hang up.",
    "Never promise outcomes. Never give medical, legal, or financial advice.",
    "Always collect a callback number before ending if anything is unresolved.",
  ].filter(Boolean);

  const bookingBlock =
    bookingInstructions ||
    "Use check_availability to find open times, then book_appointment. Confirm the service, date/time, name, and phone before booking, and read the appointment back to the caller.";

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
- Answer questions from the knowledge base below.
- Book appointments using the booking tools (check_availability, then book_appointment).
- Take a message (take_message) capturing name + phone + reason when booking isn't possible.
- Transfer to a human (transfer_to_human) on request or for sensitive matters.

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
