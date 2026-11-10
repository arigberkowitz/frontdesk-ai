/**
 * The two voice choices a business picks for its AI receptionist. A simple
 * "woman / man" choice maps to a concrete Retell voice id (both American).
 */
export type VoiceGender = "female" | "male";

export const VOICE_OPTIONS: { gender: VoiceGender; label: string; voiceId: string }[] = [
  { gender: "female", label: "A woman", voiceId: "11labs-Marissa" },
  { gender: "male", label: "A man", voiceId: "11labs-Adrian" },
];

/** Default when a business hasn't chosen (matches retell.ts DEFAULT_VOICE_ID = Adrian). */
export const DEFAULT_VOICE_GENDER: VoiceGender = "male";

export function voiceIdForGender(gender: VoiceGender): string {
  return VOICE_OPTIONS.find((v) => v.gender === gender)?.voiceId ?? VOICE_OPTIONS[1].voiceId;
}

export function genderForVoiceId(voiceId: string | null | undefined): VoiceGender {
  return VOICE_OPTIONS.find((v) => v.voiceId === voiceId)?.gender ?? DEFAULT_VOICE_GENDER;
}

/**
 * Shape used by the operator-facing voice picker. Mirrors `RetellVoice`
 * (src/lib/retell.ts) so live Retell voices and our curated fallbacks merge
 * into one list without conversion.
 */
export type VoiceMeta = {
  voiceId: string;
  name: string;
  gender?: string;
  accent?: string;
  provider?: string;
  /** A short sample clip from the voice vendor, when they offer one. */
  previewUrl?: string;
};

/**
 * Curated fallback shown when Retell isn't connected (so the picker is never
 * empty). These two IDs are the ones the app already provisions with, so they
 * are known-good; the live Retell list (when a key is set) is authoritative for
 * everything else. Anything beyond this is reachable via the "Custom" option.
 */
export const RECOMMENDED_VOICES: VoiceMeta[] = [
  { voiceId: "11labs-Marissa", name: "Marissa", gender: "female", accent: "American", provider: "elevenlabs" },
  { voiceId: "11labs-Adrian", name: "Adrian", gender: "male", accent: "American", provider: "elevenlabs" },
];

/**
 * Voices our agents can actually speak with. Retell's voice library also lists
 * xAI (Grok) voices — Ara, Aurora, Altair… — that only run on an xAI
 * speech-to-speech engine. Our agents use a Retell LLM + text-to-speech, so
 * Retell rejects them: "400 Voice xai-Ara is only supported with xai
 * speech-to-speech models." Picking one used to save it anyway and then break
 * every later Activate / re-provision for that business.
 */
const S2S_ONLY_VOICE_PREFIXES = ["xai-"];
const S2S_ONLY_PROVIDERS = new Set(["xai"]);

export function isUsableVoiceId(voiceId: string | null | undefined): boolean {
  const id = (voiceId ?? "").trim().toLowerCase();
  if (!id) return false;
  return !S2S_ONLY_VOICE_PREFIXES.some((p) => id.startsWith(p));
}

export function isUsableVoice(v: { voiceId: string; provider?: string | null }): boolean {
  if (v.provider && S2S_ONLY_PROVIDERS.has(v.provider.toLowerCase())) return false;
  return isUsableVoiceId(v.voiceId);
}

/** Shown when someone tries to save a voice our agents can't use. */
export const UNUSABLE_VOICE_ERROR =
  "That voice can't be used for phone calls yet — please pick a different one.";

/** Coarse gender bucket for the portal's "Women / Men" voice grouping. */
export function normalizeGender(g?: string | null): "female" | "male" | "other" {
  const k = (g ?? "").toLowerCase();
  if (k.startsWith("f") || k.includes("female") || k.includes("woman")) return "female";
  if (k.startsWith("m") || k.includes("male") || k.includes("man")) return "male";
  return "other";
}

const ACCENT_ALIASES: Record<string, string> = {
  uk: "British",
  gb: "British",
  british: "British",
  us: "American",
  usa: "American",
  au: "Australian",
  aus: "Australian",
  in: "Indian",
};

/** Vendor spelling slips we've seen in the live list. */
const SPELLING_FIXES: [RegExp, string][] = [
  [/portugese/gi, "Portuguese"],
  [/brasilian/gi, "Brazilian"],
];

function tidy(s: string): string {
  let out = s.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  for (const [re, fix] of SPELLING_FIXES) out = out.replace(re, fix);
  return out;
}

/**
 * Customer-facing name/accent for a vendor voice: "Amy(UK)" → Amy · British,
 * "Brazilian Portugese" → "Brazilian Portuguese", stray spacing removed.
 */
export function cleanVoiceLabel(v: VoiceMeta): VoiceMeta {
  let name = tidy(v.name);
  let accent = v.accent ? tidy(v.accent) : "";
  const m = name.match(/^(.*?)\s*[([]\s*([^)\]]+?)\s*[)\]]\s*$/);
  if (m && m[1]) {
    name = m[1].trim();
    if (!accent) accent = ACCENT_ALIASES[m[2].toLowerCase()] ?? tidy(m[2]);
  }
  if (accent && ACCENT_ALIASES[accent.toLowerCase()]) accent = ACCENT_ALIASES[accent.toLowerCase()];
  if (accent && accent === accent.toLowerCase()) accent = accent.replace(/\b\w/g, (c) => c.toUpperCase());
  return { ...v, name, accent: accent || undefined };
}

/**
 * Split a voice list into Women / Men buckets, each sorted by name, with
 * labels cleaned. Every voice name shows once, in exactly one bucket: Retell
 * lists the same name from several providers (and sometimes with different
 * gender tags), which put e.g. the default voice under both Women and Men and
 * showed Leland/Max twice. When names collide we keep, in order: the
 * business's current voice, one with a sample clip, then the first listed.
 */
export function groupVoicesByGender(
  voices: VoiceMeta[],
  currentVoiceId?: string | null,
): { women: VoiceMeta[]; men: VoiceMeta[] } {
  const rank = (v: VoiceMeta) => (v.voiceId === currentVoiceId ? 2 : v.previewUrl ? 1 : 0);
  const byName = new Map<string, VoiceMeta>();
  for (const raw of voices) {
    if (normalizeGender(raw.gender) === "other") continue;
    if (!isUsableVoice(raw)) continue;
    const v = cleanVoiceLabel(raw);
    const key = v.name.toLowerCase();
    const prev = byName.get(key);
    if (!prev || rank(v) > rank(prev)) byName.set(key, v);
  }
  const women: VoiceMeta[] = [];
  const men: VoiceMeta[] = [];
  for (const v of byName.values()) (normalizeGender(v.gender) === "female" ? women : men).push(v);
  const cmp = (a: VoiceMeta, b: VoiceMeta) => a.name.localeCompare(b.name);
  return { women: women.sort(cmp), men: men.sort(cmp) };
}

/**
 * The words around the portal voice picker. Picking a row only selects it;
 * the Save button is what changes the live agent, so the copy has to say
 * which voice callers hear now and whether there's an unsaved pick.
 */
export function voicePickerSummary(input: {
  savedName: string | null;
  selectedName: string | null;
  dirty: boolean;
  unusableSavedName?: string | null;
}): { speakingAs: string; hint: string; dirty: boolean; warning: string | null } {
  const speakingAs = input.savedName ?? (input.unusableSavedName ? `${input.unusableSavedName} (not available)` : "the default voice");
  const warning = input.unusableSavedName
    ? `${input.unusableSavedName} isn't available for phone calls. Pick another voice and click Save to switch.`
    : null;
  const hint = input.dirty
    ? `${input.selectedName ?? "New voice"} selected — click Save to use it on calls.`
    : "Click a voice to select it, or ▶ to hear a sample. Nothing changes until you save.";
  return { speakingAs, hint, dirty: input.dirty, warning };
}
