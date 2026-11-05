import { describe, expect, it } from "vitest";
import { buildAgentTools } from "./retell";
import { buildGeneralPrompt, servicePriceText, type BuildPromptInput } from "./prompt";
import { confirmationText } from "./appointment-messages";
import { priceFields, priceRangeError } from "./service-price";
import { isFieldService } from "./vocab";

const base = (client: Partial<BuildPromptInput["client"]> = {}, services: BuildPromptInput["services"] = []) =>
  buildGeneralPrompt({
    agentName: "Riley",
    client: { name: "Ace Plumbing", industry: "Plumbing", timezone: "America/New_York", escalationNumber: "+13055550100", ...client } as BuildPromptInput["client"],
    services,
    hours: [],
    knowledge: [],
  });

describe("service address", () => {
  it("field-service businesses must collect the job address", () => {
    expect(isFieldService("HVAC")).toBe(true);
    expect(isFieldService("Dental")).toBe(false);
    expect(base()).toMatch(/every booking and every message needs the service address/);
    expect(base({ industry: "Dental" })).not.toMatch(/every booking and every message needs/);
  });
  it("book_appointment and take_message accept service_address", () => {
    const tools = buildAgentTools("https://x.test", "c1", null);
    for (const n of ["book_appointment", "take_message"]) {
      const t = tools.find((x) => x.name === n) as { parameters: { properties: Record<string, unknown> } };
      expect(t.parameters.properties.service_address).toBeTruthy();
    }
  });
  it("the confirmation text carries the address", () => {
    const t = confirmationText({ business: "Ace", customerName: "Pat", when: "Mon, Nov 9 at 9:00 AM", serviceAddress: "12 Elm St" });
    expect(t).toContain("At: 12 Elm St.");
    expect(confirmationText({ business: "Ace", customerName: "Pat", when: "x", serviceAddress: "12 Elm St", language: "es" })).toContain("Dirección: 12 Elm St.");
  });
});

describe("emergencies", () => {
  it("24/7 transfer attaches transfer_emergency to the on-call number", () => {
    const tools = buildAgentTools("https://x.test", "c1", "+13055550100", "open_hours", null, false, "(305) 555-0199");
    const t = tools.find((x) => x.name === "transfer_emergency") as { transfer_destination: { number: string } };
    expect(t.transfer_destination.number).toBe("+13055550199");
    expect(buildAgentTools("https://x.test", "c1", "+13055550100").some((x) => x.name === "transfer_emergency")).toBe(false);
  });
  it("the prompt routes emergencies to transfer_emergency at any hour when on", () => {
    expect(base({ emergencyTransfer247: true, handoffMode: "open_hours" })).toMatch(/transfer_emergency immediately/);
  });
  it("off-hours with open_hours mode: urgent message, no transfer", () => {
    const p = base({ handoffMode: "open_hours" });
    expect(p).toMatch(/Outside opening hours do not transfer/);
    expect(p).toMatch(/emergency set to true/);
  });
  it("take_message has an emergency flag", () => {
    const t = buildAgentTools("https://x.test", "c1", null).find((x) => x.name === "take_message") as {
      parameters: { properties: Record<string, unknown> };
    };
    expect(t.parameters.properties.emergency).toBeTruthy();
  });
});

describe("price ranges, starts-at and trip fee", () => {
  it("formats prices", () => {
    expect(servicePriceText({ priceCents: 15000 })).toBe("$150");
    expect(servicePriceText({ priceCents: 15000, priceMaxCents: 30000 })).toBe("$150–$300");
    expect(servicePriceText({ priceCents: 9900, priceFrom: true })).toBe("starts at $99");
  });
  it("the prompt quotes ranges as estimates and mentions the trip fee", () => {
    const p = base({ tripFeeCents: 8900 }, [
      { name: "Drain clearing", durationMin: 60, priceCents: 15000, priceMaxCents: 30000, isActive: true },
    ]);
    expect(p).toContain("Drain clearing (60 min) — $150–$300 (estimate");
    expect(p).toMatch(/\$89 trip \/ service-call fee/);
    expect(base()).not.toMatch(/trip \/ service-call fee/);
  });
  it("validates and stores the range", () => {
    expect(priceRangeError({ priceDollars: 150, priceMaxDollars: 100 })).toMatch(/more than/);
    expect(priceRangeError({ priceMaxDollars: 100 })).toMatch(/starting price/);
    expect(priceFields({ priceDollars: 150, priceMaxDollars: 300, priceFrom: true })).toEqual({
      priceCents: 15000,
      priceMaxCents: 30000,
      priceFrom: false,
    });
    expect(priceFields({ priceDollars: 99, priceFrom: true })).toMatchObject({ priceFrom: true });
  });
});
