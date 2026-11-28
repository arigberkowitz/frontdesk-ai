import { describe, expect, it } from "vitest";
import { clampMonths, isDueForWinback, winbackBody, winbackSettingsOf } from "./winback";

const NOW = new Date("2026-11-20T19:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

describe("who is due for a win-back text", () => {
  it("is due once the interval has passed", () => {
    expect(isDueForWinback({ lastVisitAt: daysAgo(190), hasUpcoming: false, lastWinbackAt: null }, 6, NOW)).toBe(true);
    expect(isDueForWinback({ lastVisitAt: daysAgo(150), hasUpcoming: false, lastWinbackAt: null }, 6, NOW)).toBe(false);
  });
  it("never texts someone who already has a visit booked", () => {
    expect(isDueForWinback({ lastVisitAt: daysAgo(400), hasUpcoming: true, lastWinbackAt: null }, 12, NOW)).toBe(false);
  });
  it("sends at most one per customer per interval", () => {
    expect(isDueForWinback({ lastVisitAt: daysAgo(250), hasUpcoming: false, lastWinbackAt: daysAgo(60) }, 6, NOW)).toBe(false);
    expect(isDueForWinback({ lastVisitAt: daysAgo(400), hasUpcoming: false, lastWinbackAt: daysAgo(190) }, 6, NOW)).toBe(true);
  });
  it("gives up on someone gone more than a year past the interval", () => {
    expect(isDueForWinback({ lastVisitAt: daysAgo(182 + 400), hasUpcoming: false, lastWinbackAt: null }, 6, NOW)).toBe(false);
  });
});

describe("settings", () => {
  it("is off by default with a 6-month interval", () => {
    expect(winbackSettingsOf({})).toEqual({ enabled: false, months: 6, template: "", lastRunMonth: null });
    expect(winbackSettingsOf(null).enabled).toBe(false);
  });
  it("keeps months between 1 and 24", () => {
    expect(clampMonths("0")).toBe(1);
    expect(clampMonths(99)).toBe(24);
    expect(clampMonths("abc")).toBe(6);
  });
});

describe("the text", () => {
  it("names the business, what they had, and the opt-out line", () => {
    const t = winbackBody({ business: "Bright Smile Dental", firstName: "Maria", serviceName: "Teeth Cleaning" });
    expect(t).toBe(
      "Hi Maria, it's Bright Smile Dental. It's been a while since your teeth cleaning. Want to get your next visit on the calendar? Reply to this text and we'll find a time. Reply STOP to opt out.",
    );
  });
  it("uses the owner's wording in English and the Spanish default for Spanish speakers", () => {
    const template = "Hi {first_name}! {business} misses you.";
    expect(winbackBody({ business: "Acme", firstName: "Sam" }, { template })).toBe("Hi Sam! Acme misses you. Reply STOP to opt out.");
    const es = winbackBody({ business: "Acme", firstName: "Ana", serviceName: "Limpieza" }, { template, language: "es" });
    expect(es).toContain("Hola Ana, le escribe Acme");
    expect(es).toContain("su limpieza");
    expect(es).toContain("Responda STOP");
  });
});
