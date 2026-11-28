import { parseLanguages } from "@/lib/languages";
import { DEFAULT_AGENT_NAME, defaultGreeting, defaultGreetingEs } from "@/lib/prompt";

/**
 * The first name a voice should introduce itself as. "Allie" stays Allie;
 * "Amy (UK)" was already cleaned by the picker; we still take the first word
 * so a vendor string like "Marissa Stone" becomes "Marissa".
 */
export function voiceFirstName(name: string | null | undefined): string {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  return first.replace(/[.,;:]+$/g, "");
}

/** Best-effort name from a Retell voice id ("11labs-Marissa" → "Marissa"). */
export function displayNameFromVoiceId(voiceId: string | null | undefined): string | null {
  const id = (voiceId ?? "").trim();
  if (!id) return null;
  const base = id.replace(/^[a-z0-9]+-/i, "").trim();
  return voiceFirstName(base) || null;
}

/**
 * True when the saved agent name is ours to update: empty, the default
 * "Riley", or the previous voice's first name (the owner picked a voice and
 * we already named the agent after it).
 */
export function isStockAgentName(
  agentName: string | null | undefined,
  ...knownVoiceNames: (string | null | undefined)[]
): boolean {
  const n = (agentName ?? "").trim();
  if (!n) return true;
  if (n.toLowerCase() === DEFAULT_AGENT_NAME.toLowerCase()) return true;
  return knownVoiceNames.some((v) => {
    const known = voiceFirstName(v);
    return Boolean(known) && known.toLowerCase() === n.toLowerCase();
  });
}

export function stockGreetingFor(opts: {
  businessName: string;
  agentName: string;
  languages?: string | null;
}): string {
  const language = parseLanguages(opts.languages)[0] === "es" ? "es" : "en";
  return language === "es"
    ? defaultGreetingEs({ name: opts.businessName }, opts.agentName)
    : defaultGreeting({ name: opts.businessName }, opts.agentName);
}

export function isStockGreeting(opts: {
  greeting: string | null | undefined;
  businessName: string;
  agentNames: (string | null | undefined)[];
  languages?: string | null;
}): boolean {
  const g = opts.greeting?.trim() ?? "";
  if (!g) return true;
  const names = [DEFAULT_AGENT_NAME, ...opts.agentNames]
    .map((n) => (n ?? "").trim())
    .filter(Boolean);
  const unique = [...new Set(names)];
  return unique.some(
    (agentName) => g === stockGreetingFor({ businessName: opts.businessName, agentName, languages: opts.languages }),
  );
}

function replaceWholeName(text: string, from: string, to: string): string {
  if (!from || from.toLowerCase() === to.toLowerCase()) return text;
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`\\b${escaped}\\b`, "gi"), to);
}

export type VoiceIdentityChange =
  | { kind: "adopted"; agentName: string; greeting: string | null; greetingUpdated: boolean }
  | { kind: "kept"; agentName: string };

/**
 * What to do with the agent's name and opening line when the owner saves a
 * new voice. A custom name (anything other than Riley or the previous voice)
 * is kept, and we say so in the save toast. Stock names and stock greetings
 * follow the new voice, so "This is Riley" becomes "This is Marissa".
 */
export function voiceIdentityUpdate(input: {
  voiceName: string;
  businessName: string;
  currentAgentName: string | null | undefined;
  currentGreeting: string | null | undefined;
  languages?: string | null;
  previousVoiceName?: string | null;
}): VoiceIdentityChange {
  const newName = voiceFirstName(input.voiceName);
  const current = (input.currentAgentName ?? "").trim() || DEFAULT_AGENT_NAME;
  if (!newName) return { kind: "kept", agentName: current };

  const previous = voiceFirstName(input.previousVoiceName);
  if (!isStockAgentName(input.currentAgentName, previous, input.previousVoiceName)) {
    return { kind: "kept", agentName: current };
  }

  const greetingRaw = input.currentGreeting?.trim() ?? "";
  if (!greetingRaw) {
    // Null greeting means openingLine builds the default from agentName.
    return { kind: "adopted", agentName: newName, greeting: null, greetingUpdated: false };
  }

  if (
    isStockGreeting({
      greeting: greetingRaw,
      businessName: input.businessName,
      agentNames: [current, previous, DEFAULT_AGENT_NAME, newName],
      languages: input.languages,
    })
  ) {
    return {
      kind: "adopted",
      agentName: newName,
      greeting: stockGreetingFor({
        businessName: input.businessName,
        agentName: newName,
        languages: input.languages,
      }),
      greetingUpdated: true,
    };
  }

  // Custom greeting: if it still uses Riley or the previous voice's name,
  // swap just that word so the opening line matches the new voice.
  let greeting = greetingRaw;
  for (const from of [previous, current, DEFAULT_AGENT_NAME]) {
    if (from) greeting = replaceWholeName(greeting, from, newName);
  }
  return {
    kind: "adopted",
    agentName: newName,
    greeting,
    greetingUpdated: greeting !== greetingRaw,
  };
}

export function voiceIdentitySaveMessage(change: VoiceIdentityChange, voiceName: string): string {
  const newName = voiceFirstName(voiceName) || voiceName;
  if (change.kind === "adopted") {
    return `Voice saved — your receptionist now uses it on calls, and introduces themselves as ${change.agentName}.`;
  }
  return `Voice saved — your receptionist now uses it on calls. The name stays ${change.agentName}; change it under Greeting if you want them to introduce themselves as ${newName}.`;
}

export function voiceIdentityHint(opts: {
  dirty: boolean;
  selectedName: string | null;
  currentAgentName: string | null | undefined;
  previousVoiceName?: string | null;
}): string | null {
  if (!opts.dirty || !opts.selectedName) return null;
  const newName = voiceFirstName(opts.selectedName);
  if (!newName) return null;
  if (isStockAgentName(opts.currentAgentName, opts.previousVoiceName)) {
    return `Callers will hear this voice introduce themselves as ${newName}.`;
  }
  const kept = (opts.currentAgentName ?? "").trim() || DEFAULT_AGENT_NAME;
  return `The voice will change, but the name stays ${kept}. Change it under Greeting if you want them to introduce themselves as ${newName}.`;
}
