/**
 * Which languages the receptionist answers in.
 *
 * Stored in `clients.languages` (text, no migration) as the language codes the
 * business picked, primary first:
 *   - "en"            English only (default)
 *   - "en-es"         English first + Spanish   (legacy value, still written)
 *   - "es"            Spanish first + English   (legacy value, still written)
 *   - "en,es,fr"      English first + Spanish + French (new: any other list)
 *
 * The primary language is the one the call opens in. The agent detects the
 * caller's language from the others and switches.
 *
 * The selectable set is deliberately the ten languages Retell's legacy
 * "multi" setting covered. That combination is known to work together in
 * Retell's multilingual speech recognition and with our ElevenLabs voices.
 * Retell supports many more locales, but each extra language must be supported
 * by the voice AND by one speech-recognition provider covering the whole set,
 * which we can't check from here. Add more only after a test call.
 *
 * Pure and client-safe.
 */

export interface LanguageOption {
  code: string;
  /** English name (portal UI, prompt). */
  label: string;
  /** Name in the language itself (prompt + UI). */
  native: string;
  /** Retell agent locale. */
  locale: RetellLocale;
}

export type RetellLocale =
  | "en-US"
  | "es-ES"
  | "fr-FR"
  | "de-DE"
  | "pt-PT"
  | "it-IT"
  | "nl-NL"
  | "ru-RU"
  | "hi-IN"
  | "ja-JP";

export const LANGUAGE_OPTIONS: readonly LanguageOption[] = [
  { code: "en", label: "English", native: "English", locale: "en-US" },
  // Retell's Spanish locales are es-ES and es-419. es-ES is the one in the
  // documented en-US + es-ES multilingual pairing (and in the legacy "multi"
  // set); the accent comes from the voice, not this code.
  { code: "es", label: "Spanish", native: "Español", locale: "es-ES" },
  { code: "fr", label: "French", native: "Français", locale: "fr-FR" },
  { code: "pt", label: "Portuguese", native: "Português", locale: "pt-PT" },
  { code: "de", label: "German", native: "Deutsch", locale: "de-DE" },
  { code: "it", label: "Italian", native: "Italiano", locale: "it-IT" },
  { code: "ru", label: "Russian", native: "Русский", locale: "ru-RU" },
  { code: "hi", label: "Hindi", native: "हिन्दी", locale: "hi-IN" },
  { code: "ja", label: "Japanese", native: "日本語", locale: "ja-JP" },
  { code: "nl", label: "Dutch", native: "Nederlands", locale: "nl-NL" },
];

const BY_CODE = new Map(LANGUAGE_OPTIONS.map((l) => [l.code, l]));

/** Keep a voice call's language set small: every extra language costs recognition accuracy. */
export const MAX_LANGUAGES = 4;

export function languageOption(code: string): LanguageOption | undefined {
  return BY_CODE.get(code);
}

/** Parse the stored setting into codes, primary first. Unknown codes are dropped; never empty. */
export function parseLanguages(raw: string | null | undefined): string[] {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "en-es") return ["en", "es"];
  if (v === "es") return ["es", "en"];
  const codes = v
    .split(/[\s,]+/)
    .map((c) => c.trim())
    .filter((c, i, all) => c && BY_CODE.has(c) && all.indexOf(c) === i)
    .slice(0, MAX_LANGUAGES);
  return codes.length ? codes : ["en"];
}

/**
 * Store a list. The three legacy shapes keep their legacy values, so nothing
 * that reads "en-es"/"es" changes and a rollback still understands them.
 */
export function serializeLanguages(codes: readonly string[]): string {
  const list = parseLanguages(codes.join(","));
  const key = list.join(",");
  if (key === "en") return "en";
  if (key === "en,es") return "en-es";
  if (key === "es,en") return "es";
  return key;
}

export function isMultilingual(codes: readonly string[]): boolean {
  return codes.length > 1;
}

/**
 * Retell agent `language`: one locale, or an explicit locale array (primary
 * first: Retell falls back to the first one when it can't detect a response's
 * language). The old scalar "multi" is deprecated. Retell still accepts it
 * but expands it to all ten legacy languages, which is the least accurate
 * setup.
 */
export function retellLanguage(codes: readonly string[]): RetellLocale | RetellLocale[] {
  const locales = codes.map((c) => BY_CODE.get(c)?.locale).filter((l): l is RetellLocale => Boolean(l));
  if (locales.length === 0) return "en-US";
  return locales.length === 1 ? locales[0] : locales;
}

/**
 * The ElevenLabs model to pin when the agent speaks anything but English.
 * Our two voices are ElevenLabs. Their English-only models (eleven_turbo_v2,
 * eleven_flash_v2) can't pronounce other languages, and Retell rejects a
 * language the voice model doesn't support. Flash v2.5 is multilingual and
 * keeps latency low. English-only agents are left on Retell's default.
 */
export const MULTILINGUAL_VOICE_MODEL = "eleven_flash_v2_5" as const;

export function voiceModelFor(codes: readonly string[]): typeof MULTILINGUAL_VOICE_MODEL | undefined {
  return codes.some((c) => c !== "en") ? MULTILINGUAL_VOICE_MODEL : undefined;
}

/** "English, Spanish and French". */
export function languageNames(codes: readonly string[]): string {
  const names = codes.map((c) => BY_CODE.get(c)?.label ?? c);
  if (names.length <= 1) return names[0] ?? "English";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Map whatever the agent passed as the caller's language ("es", "Spanish",
 * "español", "es-MX") to one of OUR codes, or null when it isn't one we
 * offer.
 */
export function normalizeCustomerLanguage(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (!v) return null;
  const base = v.split(/[-_\s]/)[0];
  if (BY_CODE.has(base)) return base;
  const byName = LANGUAGE_OPTIONS.find(
    (l) =>
      l.label.toLowerCase() === v ||
      l.native
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") === v,
  );
  if (byName) return byName.code;
  if (v === "espanol" || v === "castellano") return "es";
  return null;
}

/* ------------------------- caller-language prompt ------------------------- */

/** The disclosure sentence in Spanish: the language we wrote, not translated by a model. */
export function spanishDisclosure(business: string, recording: boolean): string {
  return recording
    ? `Le informo que soy un asistente de inteligencia artificial de ${business} y que esta llamada puede ser grabada.`
    : `Le informo que soy un asistente de inteligencia artificial de ${business}.`;
}

/** The SMS consent ask, translated. STOP stays in English: it's the carrier opt-out keyword. */
export const SPANISH_CONSENT_ASK =
  "¿Le gustaría que le enviara por mensaje de texto la confirmación y un recordatorio? Pueden aplicarse tarifas de mensajes y datos, y puede responder STOP en cualquier momento para dejar de recibirlos.";

/**
 * The prompt rules for a multilingual (or non-English-first) agent: one entry
 * per bullet. Empty for English only, which needs no instruction.
 */
export function languagePromptRules(
  codes: readonly string[],
  opts: { business: string; recording: boolean },
): string[] {
  if (codes.length === 1 && codes[0] === "en") return [];
  const business = opts.business.replace(/\s+/g, " ").trim();
  const primary = BY_CODE.get(codes[0]) ?? BY_CODE.get("en")!;
  const others = codes.slice(1).map((c) => BY_CODE.get(c)!).filter(Boolean);
  const lines: string[] = [];

  if (others.length === 0) {
    lines.push(
      `Speak with callers in fluent, natural ${primary.label} (${primary.native}). If a caller can't continue in ${primary.label}, take a message so the team can call them back.`,
    );
  } else {
    lines.push(
      `You speak ${languageNames(codes)}. Open in ${primary.label}. The moment a caller speaks ${others.map((o) => `${o.label} (${o.native})`).join(" or ")}, or asks for it, switch and continue the whole call in that language, naturally and fluently. Switch back if they do. Always answer in the caller's language. If they speak a language you don't offer, keep it simple in ${primary.label}, or take a message so the team can call back.`,
    );
  }

  const spanish = codes.includes("es");
  lines.push(
    `Disclosure in the caller's language: when you switch to a language other than the one your opening line was in, your FIRST sentence in that language must repeat that you're an AI assistant for ${business}${opts.recording ? " and that the call may be recorded" : ""}${spanish ? `. In Spanish, say exactly: "${spanishDisclosure(business, opts.recording)}"` : ""}. In any other language, translate that sentence faithfully. Never skip it, and never say you're human in any language.`,
  );
  lines.push(
    `Text-message consent in the caller's language: ask the consent question below in the language you're speaking. ${spanish ? `In Spanish, ask exactly: "${SPANISH_CONSENT_ASK}" ` : ""}In any other language, translate it faithfully and keep the word STOP in English. The same rule applies: only a clear yes counts.`,
  );
  lines.push(
    `When you book, pass "language" as the code of the language the caller spoke (${codes.map((c) => `"${c}"`).join(", ")}), so their confirmation and reminder texts are sent in that language.`,
  );
  lines.push(
    "Business names, service names, staff names and addresses stay exactly as written. Don't translate them. Translate only what you say around them.",
  );
  return lines;
}

/* ------------------------------ settings form ----------------------------- */

/** The call can open in English or Spanish (the two greetings we've written). */
export const OPENING_LANGUAGES = ["en", "es"] as const;

/**
 * The Phone & AI form → the stored value. The primary must be an opening
 * language. Extras are de-duplicated and capped, so the agent never gets a
 * language set too wide to recognize well.
 */
export function languagesFromForm(primary: unknown, extras: unknown[]): string {
  const p = typeof primary === "string" && (OPENING_LANGUAGES as readonly string[]).includes(primary) ? primary : "en";
  const rest = extras
    .map((e) => (typeof e === "string" ? e.trim().toLowerCase() : ""))
    .filter((c) => c && c !== p && BY_CODE.has(c));
  return serializeLanguages([p, ...rest]);
}
