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

/** Coarse gender bucket for the portal's "Women / Men" voice grouping. */
export function normalizeGender(g?: string | null): "female" | "male" | "other" {
  const k = (g ?? "").toLowerCase();
  if (k.startsWith("f") || k.includes("female") || k.includes("woman")) return "female";
  if (k.startsWith("m") || k.includes("male") || k.includes("man")) return "male";
  return "other";
}

/**
 * Split a voice list into Women / Men buckets, each sorted by name. Voices that
 * would display identically (same name + accent) are collapsed to one — Retell
 * returns several indistinguishable variants and showing all of them is just noise.
 */
export function groupVoicesByGender(voices: VoiceMeta[]): { women: VoiceMeta[]; men: VoiceMeta[] } {
  const women: VoiceMeta[] = [];
  const men: VoiceMeta[] = [];
  const seen = new Set<string>();
  for (const v of voices) {
    const g = normalizeGender(v.gender);
    if (g === "other") continue;
    const label = `${g}|${v.name.toLowerCase().trim()}|${(v.accent ?? "").toLowerCase().trim()}`;
    if (seen.has(label)) continue;
    seen.add(label);
    (g === "female" ? women : men).push(v);
  }
  const byName = (a: VoiceMeta, b: VoiceMeta) => a.name.localeCompare(b.name);
  return { women: women.sort(byName), men: men.sort(byName) };
}
