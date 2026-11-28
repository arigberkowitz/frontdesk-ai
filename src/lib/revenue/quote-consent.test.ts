import { describe, expect, it } from "vitest";
import {
  QUOTE_CONSENT_QUESTION,
  QUOTE_CONSENT_QUESTION_ES,
  isQuoteConsentWording,
  quoteConsentAskOn,
  quoteConsentPromptRule,
  quoteConsentWordingFor,
} from "./quote-consent";

describe("quote consent ask", () => {
  it("is on only with Pro + follow-up on + the ask switch on", () => {
    expect(quoteConsentAskOn({ planAllows: true, settings: { enabled: true, askConsent: true } })).toBe(true);
    expect(quoteConsentAskOn({ planAllows: false, settings: { enabled: true, askConsent: true } })).toBe(false);
    expect(quoteConsentAskOn({ planAllows: true, settings: { enabled: false, askConsent: true } })).toBe(false);
    expect(quoteConsentAskOn({ planAllows: true, settings: { enabled: true, askConsent: false } })).toBe(false);
    // Default OFF: never set means off.
    expect(quoteConsentAskOn({ planAllows: true, settings: { enabled: true } })).toBe(false);
  });

  it("asks an honest, explicit question with STOP", () => {
    expect(QUOTE_CONSENT_QUESTION).toMatch(/\?/);
    expect(QUOTE_CONSENT_QUESTION).toMatch(/STOP/);
    expect(QUOTE_CONSENT_QUESTION).toMatch(/at most two texts/);
    expect(QUOTE_CONSENT_QUESTION_ES).toMatch(/STOP/);
  });

  it("puts the exact question in the prompt, and only a clear yes counts", () => {
    const rule = quoteConsentPromptRule({ spanish: false });
    expect(rule).toContain(QUOTE_CONSENT_QUESTION);
    expect(rule).not.toContain(QUOTE_CONSENT_QUESTION_ES);
    expect(rule).toMatch(/Only a clear yes counts/);
    expect(rule).toMatch(/text_consent as true only if they clearly said yes/);
    expect(quoteConsentPromptRule({ spanish: true })).toContain(QUOTE_CONSENT_QUESTION_ES);
  });

  it("versions the receipt by language", () => {
    expect(quoteConsentWordingFor(null)).toBe("quote-v1");
    expect(quoteConsentWordingFor("en")).toBe("quote-v1");
    expect(quoteConsentWordingFor("es")).toBe("quote-v1-es");
    expect(quoteConsentWordingFor("<script>")).toBe("quote-v1");
    expect(isQuoteConsentWording("quote-v1-es")).toBe(true);
    expect(isQuoteConsentWording("booking-v2")).toBe(false);
  });
});
