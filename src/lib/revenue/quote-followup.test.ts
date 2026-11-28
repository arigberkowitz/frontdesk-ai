import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEMPLATES,
  MAX_BODY_CHARS,
  OPT_OUT_EN,
  OPT_OUT_ES,
  dueStep,
  firstNameOf,
  gateMessage,
  isQuoteRequest,
  parseSettings,
  phoneKey,
  quoteFollowupEnabled,
  renderFollowup,
  stopReason,
  templateProblem,
  withinSendHours,
  type CandidateFacts,
} from "./quote-followup";

const H = 3_600_000;
const t = (iso: string) => new Date(iso);

describe("settings", () => {
  it("is off unless someone turned it on", () => {
    expect(quoteFollowupEnabled({ setupFlags: {} })).toBe(false);
    expect(quoteFollowupEnabled({ setupFlags: null })).toBe(false);
    expect(quoteFollowupEnabled({ setupFlags: { quoteFollowup: "yes" } })).toBe(false);
    expect(quoteFollowupEnabled({ setupFlags: { quoteFollowup: { enabled: "true" } } })).toBe(false);
    expect(quoteFollowupEnabled({ setupFlags: { quoteFollowup: { enabled: true } } })).toBe(true);
  });
  it("reads custom templates and ignores blanks", () => {
    expect(parseSettings({ quoteFollowup: { enabled: true, step1Template: "  ", step2Template: "Hi" } })).toMatchObject({
      enabled: true,
      step1Template: undefined,
      step2Template: "Hi",
    });
  });
});

describe("isQuoteRequest", () => {
  it("catches quote, price and estimate wording in English", () => {
    for (const s of ["Wants a quote for a water heater", "asked how much a cleaning costs", "Free estimate request", "pricing question", "ballpark on the roof"]) {
      expect(isQuoteRequest({ summary: s })).toBe(true);
    }
  });
  it("catches Spanish, with or without accents", () => {
    expect(isQuoteRequest({ summary: "Quiere una cotización para el techo" })).toBe(true);
    expect(isQuoteRequest({ leadReason: "cuanto cuesta arreglar el calentador" })).toBe(true);
    expect(isQuoteRequest({ leadMessage: "Necesito un presupuesto" })).toBe(true);
  });
  it("reads lead fields too", () => {
    expect(isQuoteRequest({ leadReason: "Water heater quote" })).toBe(true);
    expect(isQuoteRequest({ leadBudget: "wants a price first" })).toBe(true);
  });
  it("only counts what the caller said in a transcript, not the agent", () => {
    expect(isQuoteRequest({ transcript: "Agent: We can give you an estimate if you like.\nUser: I need a plumber tomorrow." })).toBe(false);
    expect(isQuoteRequest({ transcript: "Agent: Hi!\nUser: How much would it cost to fix a leak?" })).toBe(true);
  });
  it("says no to calls that aren't about price", () => {
    expect(isQuoteRequest({ summary: "Asked about opening hours and parking." })).toBe(false);
    expect(isQuoteRequest({})).toBe(false);
  });
  it("doesn't match words that only contain a quote word", () => {
    expect(isQuoteRequest({ summary: "Asked about the pricey parking garage" })).toBe(false);
    expect(isQuoteRequest({ summary: "Caller was frustrated by the ratesheet" })).toBe(false);
  });
});

describe("renderFollowup", () => {
  it("names the business and the caller and ends with the opt-out line", () => {
    const b = renderFollowup({ step: 1, businessName: "Ohana Plumbing", customerName: "Maria Lopez" });
    expect(b).toBe(
      "Hi Maria, it's Ohana Plumbing. You called about a quote. Still need one? Reply here and we'll get you set up. Reply STOP to opt out.",
    );
  });
  it("reads cleanly with no name", () => {
    const b = renderFollowup({ step: 2, businessName: "Ohana Plumbing", customerName: null });
    expect(b.startsWith("Hi, Ohana Plumbing again.")).toBe(true);
    expect(b).not.toContain(" ,");
    expect(b.endsWith(OPT_OUT_EN)).toBe(true);
  });
  it("won't use a phone number or odd text as a name", () => {
    expect(firstNameOf("415-555-0100")).toBe("");
    expect(firstNameOf("  Zoë   Chen ")).toBe("Zoë");
    expect(firstNameOf("A".repeat(40))).toBe("");
  });
  it("sends Spanish callers the Spanish text with its opt-out line", () => {
    const b = renderFollowup({ step: 1, businessName: "Ohana", customerName: "Ana", language: "es" });
    expect(b).toContain("cotización");
    expect(b.endsWith(OPT_OUT_ES)).toBe(true);
    expect(b).toContain("Ohana");
  });
  it("uses an owner's English template but always names the business and adds the opt-out line", () => {
    const b = renderFollowup({ step: 1, businessName: "Ohana", customerName: "Ana", template: "Still want that quote, {name}?" });
    expect(b).toBe("Ohana: Still want that quote, Ana? Reply STOP to opt out.");
  });
  it("doesn't use an English template for a Spanish caller", () => {
    const b = renderFollowup({ step: 1, businessName: "Ohana", customerName: "Ana", language: "es", template: "English only" });
    expect(b).not.toContain("English only");
  });
  it("can't be talked out of the opt-out line, and caps its length", () => {
    const b = renderFollowup({ step: 1, businessName: "Ohana", template: "x".repeat(2000) });
    expect(b.length).toBeLessThanOrEqual(MAX_BODY_CHARS);
    const ok = renderFollowup({ step: 1, businessName: "Ohana", template: "Hi from {business}. Reply STOP to opt out." });
    expect(ok.match(/Reply STOP to opt out\./g)).toHaveLength(1);
  });
  it("strips line breaks and control characters from the business name", () => {
    const b = renderFollowup({ step: 1, businessName: "Ohana\n\nPlumbing\u0007", customerName: "Ana" });
    expect(b).toContain("Ohana Plumbing");
    expect(b).not.toMatch(/[\u0000-\u001f]/);
  });
  it("default wording makes no price, discount or deadline claim", () => {
    for (const lang of ["en", "es"] as const) {
      for (const step of [1, 2] as const) {
        const text = DEFAULT_TEMPLATES[lang][step];
        expect(text).not.toMatch(/[$%]|\d|gratis|free|discount|descuento|today only|hoy/i);
      }
    }
  });
});

describe("templateProblem", () => {
  it("accepts empty and normal text", () => {
    expect(templateProblem("")).toBeNull();
    expect(templateProblem("Hi {name}, still need that quote from {business}?")).toBeNull();
  });
  it("rejects links and long text", () => {
    expect(templateProblem("See https://x.co/deal")).toMatch(/links/i);
    expect(templateProblem("visit www.example.com")).toMatch(/links/i);
    expect(templateProblem("x".repeat(301))).toMatch(/300/);
  });
});

describe("withinSendHours (business time zone, 9am to 7pm)", () => {
  const tz = "America/Los_Angeles";
  it("is true from 9:00 to 18:59 local", () => {
    expect(withinSendHours(t("2026-10-15T16:00:00Z"), tz)).toBe(true); // 9:00 PDT
    expect(withinSendHours(t("2026-10-16T01:59:00Z"), tz)).toBe(true); // 18:59 PDT
  });
  it("is false before 9 and from 7pm", () => {
    expect(withinSendHours(t("2026-10-15T15:59:00Z"), tz)).toBe(false); // 8:59
    expect(withinSendHours(t("2026-10-16T02:00:00Z"), tz)).toBe(false); // 19:00
    expect(withinSendHours(t("2026-10-15T09:00:00Z"), tz)).toBe(false); // 2am
  });
  it("follows DST, not a fixed offset", () => {
    expect(withinSendHours(t("2026-12-15T17:00:00Z"), tz)).toBe(true); // 9:00 PST
    expect(withinSendHours(t("2026-12-15T16:00:00Z"), tz)).toBe(false); // 8:00 PST
  });
  it("never sends for an unknown zone", () => {
    expect(withinSendHours(t("2026-10-15T20:00:00Z"), "Not/AZone")).toBe(false);
  });
});

describe("dueStep", () => {
  const call = t("2026-10-10T18:00:00Z");
  const at = (hours: number) => new Date(call.getTime() + hours * H);
  it("step 1 is due from 24 hours after the call, not before", () => {
    expect(dueStep({ callAt: call, now: at(23) })).toBeNull();
    expect(dueStep({ callAt: call, now: at(24) })).toBe(1);
    expect(dueStep({ callAt: call, now: at(60) })).toBe(1);
  });
  it("step 1 is dropped once it's stale, e.g. the switch came on days later", () => {
    expect(dueStep({ callAt: call, now: at(73) })).toBeNull();
    expect(dueStep({ callAt: call, now: at(24 * 6) })).toBeNull();
  });
  it("step 2 needs step 1 to have gone out", () => {
    expect(dueStep({ callAt: call, now: at(24 * 7) })).toBeNull();
    expect(dueStep({ callAt: call, now: at(24 * 7), step1SentAt: at(26) })).toBe(2);
  });
  it("step 2 waits for a week after the call and a gap after step 1", () => {
    expect(dueStep({ callAt: call, now: at(24 * 6), step1SentAt: at(26) })).toBeNull();
    expect(dueStep({ callAt: call, now: at(24 * 7), step1SentAt: at(24 * 4) })).toBeNull(); // only 3 days after step 1
  });
  it("step 2 goes once and is dropped when stale", () => {
    expect(dueStep({ callAt: call, now: at(24 * 8), step1SentAt: at(26), step2SentAt: at(24 * 7) })).toBeNull();
    expect(dueStep({ callAt: call, now: at(24 * 11), step1SentAt: at(26) })).toBeNull();
  });
  it("never for a call in the future", () => {
    expect(dueStep({ callAt: call, now: at(-1) })).toBeNull();
  });
});

describe("stopReason", () => {
  const ok: CandidateFacts = {
    phone: "+14155550100",
    bookedSince: false,
    hasUpcoming: false,
    repliedSince: false,
    calledBackSince: false,
    leadClosed: false,
    otherTextSince: false,
    blocked: false,
    optedOut: false,
    consented: true,
  };
  it("lets a clean candidate through", () => {
    expect(stopReason(ok)).toBeNull();
  });
  it.each([
    [{ phone: null }, "no_phone"],
    [{ blocked: true }, "blocked"],
    [{ optedOut: true }, "opted_out"],
    [{ bookedSince: true }, "booked"],
    [{ hasUpcoming: true }, "has_upcoming"],
    [{ repliedSince: true }, "replied"],
    [{ calledBackSince: true }, "called_back"],
    [{ leadClosed: true }, "lead_closed"],
    [{ otherTextSince: true }, "owner_followed_up"],
    [{ consented: false }, "no_consent"],
  ] as const)("stops for %j", (over, why) => {
    expect(stopReason({ ...ok, ...over })).toBe(why);
  });
  it("opt-out and block win over everything else", () => {
    expect(stopReason({ ...ok, optedOut: true, bookedSince: true })).toBe("opted_out");
    expect(stopReason({ ...ok, blocked: true, consented: false })).toBe("blocked");
  });
});

describe("misc", () => {
  it("phoneKey is the last ten digits", () => {
    expect(phoneKey("+1 (415) 555-0100")).toBe("4155550100");
    expect(phoneKey("5550100")).toBeNull();
  });
  it("explains each gate in plain words", () => {
    expect(gateMessage(null)).toBeNull();
    expect(gateMessage("no_texting_number")).toMatch(/texting number/);
    expect(gateMessage("texting_not_approved")).toMatch(/approved/);
    expect(gateMessage("suspended")).toMatch(/isn't active/);
  });
});
