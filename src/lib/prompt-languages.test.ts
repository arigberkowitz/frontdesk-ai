import { describe, expect, it } from "vitest";
import {
  buildGeneralPrompt,
  hasAiDisclosure,
  hasAiDisclosureEs,
  hasRecordingNoticeEs,
  openingLine,
  withRequiredDisclosure,
  type BuildPromptInput,
} from "./prompt";
import { SPANISH_CONSENT_ASK } from "./languages";

/** Multilingual answering: the prompt's language rules and a Spanish-first opening line. */

const input = (languages: string, recording = true): BuildPromptInput => ({
  agentName: "Riley",
  client: {
    name: "Bayside Plumbing",
    timezone: "America/New_York",
    recordingDisclosureEnabled: recording,
    recordingDisclosureLine: null,
    languages,
    bookingEnabled: true,
  },
  services: [],
  hours: [],
  knowledge: [],
});

describe("prompt language rules", () => {
  it("English only: no language rules", () => {
    const p = buildGeneralPrompt(input("en"));
    expect(p).not.toMatch(/Disclosure in the caller's language/);
    expect(p).not.toMatch(/pass "language"/);
  });

  it("bilingual: switch, disclosure + consent in Spanish, all as separate rule bullets", () => {
    const p = buildGeneralPrompt(input("en-es"));
    expect(p).toMatch(/^- You speak English and Spanish\. Open in English\./m);
    expect(p).toMatch(/^- Disclosure in the caller's language:.*puede ser grabada/m);
    expect(p).toContain(SPANISH_CONSENT_ASK);
    // The English consent script (A2P-registered wording) is still there, verbatim.
    expect(p).toContain(
      '"Would you like me to text you the confirmation and a reminder? Message and data rates may apply, and you can reply STOP at any time to opt out."',
    );
    // Language rules come right after the precedence rule, so they're inside the protected Rules section.
    const rules = p.slice(p.indexOf("# Rules"));
    expect(rules).toContain("You speak English and Spanish");
  });

  it("Spanish first opens in Spanish", () => {
    expect(buildGeneralPrompt(input("es"))).toMatch(/You speak Spanish and English\. Open in Spanish\./);
  });

  it("a configurable list", () => {
    const p = buildGeneralPrompt(input("en,es,fr"));
    expect(p).toMatch(/You speak English, Spanish and French/);
    expect(p).toMatch(/"en", "es", "fr"/);
  });

  it("recording off → no recording claim in any language", () => {
    const p = buildGeneralPrompt(input("en-es", false));
    expect(p).not.toContain("puede ser grabada");
  });
});

describe("Spanish-first opening line", () => {
  const base = { name: "Bayside Plumbing", recordingDisclosureEnabled: true, recordingDisclosureLine: null };

  it("default greeting is Spanish and carries both disclosures", () => {
    const line = openingLine({ ...base, languages: "es" });
    expect(line).toBe(
      "Le informo que esta llamada puede ser grabada. ¡Hola, gracias por llamar a Bayside Plumbing! Soy Riley, el asistente de inteligencia artificial. ¿En qué le puedo ayudar?",
    );
    expect(hasAiDisclosureEs(line)).toBe(true);
    // The AI part is in the greeting; only the recording notice is added, in Spanish.
    expect(line).toContain("Le informo que esta llamada puede ser grabada.");
    expect(hasRecordingNoticeEs(line)).toBe(true);
  });

  it("a custom greeting without disclosure gets the Spanish disclosure prepended", () => {
    const line = openingLine({ ...base, languages: "es", greeting: "Plomería Bayside, ¿en qué le ayudo?" });
    expect(line).toBe(
      "Hola, se ha comunicado con el asistente de inteligencia artificial de Bayside Plumbing, y esta llamada puede ser grabada. Plomería Bayside, ¿en qué le ayudo?",
    );
  });

  it("a Spanish greeting denying it's AI still gets the disclosure", () => {
    const line = withRequiredDisclosure("Hola, soy una persona real.", { businessName: "B", recording: false, language: "es" });
    expect(line.startsWith("Hola, se ha comunicado con el asistente de inteligencia artificial de B.")).toBe(true);
  });

  it("English-first bilingual businesses keep the English opening", () => {
    const line = openingLine({ ...base, languages: "en-es" });
    expect(line).toMatch(/^Just so you know, this call may be recorded\. Hi, thanks for calling Bayside Plumbing/);
    expect(hasAiDisclosure(line)).toBe(true);
  });
});
