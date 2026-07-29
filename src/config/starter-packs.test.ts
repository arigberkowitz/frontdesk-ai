import { describe, expect, it } from "vitest";
import {
  DEFAULT_PACK,
  STARTER_PACKS,
  packForIndustry,
  safeIndustry,
  type StarterPack,
} from "@/config/starter-packs";
import { INDUSTRIES } from "@/config/options";
import { vocabFor } from "@/lib/vocab";

const ALL_PACKS: StarterPack[] = [DEFAULT_PACK, ...STARTER_PACKS];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

describe("starter pack integrity", () => {
  it("every pack industry is a known INDUSTRIES option, with no duplicates", () => {
    const seen = new Set<string>();
    for (const p of STARTER_PACKS) {
      expect(p.industry, "packs must declare an industry").toBeTruthy();
      expect(INDUSTRIES).toContain(p.industry);
      expect(seen.has(p.industry!)).toBe(false);
      seen.add(p.industry!);
    }
  });

  it("services are well-formed (unique names, sane durations, non-negative integer prices)", () => {
    for (const p of ALL_PACKS) {
      expect(p.services.length).toBeGreaterThanOrEqual(3);
      const names = p.services.map((s) => s.name.toLowerCase());
      expect(new Set(names).size).toBe(names.length);
      for (const s of p.services) {
        expect(s.name.trim()).not.toBe("");
        expect(s.description.trim()).not.toBe("");
        expect(s.durationMin).toBeGreaterThanOrEqual(15);
        expect(s.durationMin).toBeLessThanOrEqual(240);
        if (s.priceCents !== null) {
          expect(Number.isInteger(s.priceCents)).toBe(true);
          expect(s.priceCents).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it("FAQ entries are non-empty and unique per pack", () => {
    for (const p of ALL_PACKS) {
      expect(p.faq.length).toBeGreaterThanOrEqual(3);
      const questions = p.faq.map((f) => f.question.toLowerCase());
      expect(new Set(questions).size).toBe(questions.length);
      for (const f of p.faq) {
        expect(f.question.trim()).not.toBe("");
        expect(f.answer.trim()).not.toBe("");
      }
    }
  });

  it("hours cover each day exactly once with valid open < close times", () => {
    for (const p of ALL_PACKS) {
      expect(p.hours.map((h) => h.dayOfWeek).sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
      for (const h of p.hours) {
        expect(h.openTime).toMatch(TIME);
        expect(h.closeTime).toMatch(TIME);
        expect(h.openTime < h.closeTime).toBe(true);
      }
      // A business that's never open would be a broken template.
      expect(p.hours.some((h) => !h.isClosed)).toBe(true);
    }
  });

  it("guardrails and booking instructions are substantive", () => {
    for (const p of ALL_PACKS) {
      expect(p.guardrails.length).toBeGreaterThan(80);
      expect(p.booking.length).toBeGreaterThan(50);
    }
  });
});

describe("packForIndustry", () => {
  it("resolves each pack by its own industry (case-insensitively)", () => {
    for (const p of STARTER_PACKS) {
      expect(packForIndustry(p.industry)).toBe(p);
      expect(packForIndustry(p.industry!.toUpperCase())).toBe(p);
    }
  });

  it("falls back to the default pack for unknown, empty, or null industries", () => {
    expect(packForIndustry(null)).toBe(DEFAULT_PACK);
    expect(packForIndustry("")).toBe(DEFAULT_PACK);
    expect(packForIndustry("Space tourism")).toBe(DEFAULT_PACK);
    expect(packForIndustry("Other")).toBe(DEFAULT_PACK);
  });
});

describe("safeIndustry", () => {
  it("accepts exact INDUSTRIES values and rejects everything else", () => {
    expect(safeIndustry("Dental")).toBe("Dental");
    expect(safeIndustry("  Law  ")).toBe("Law");
    expect(safeIndustry("dental")).toBeNull(); // form sends exact values
    expect(safeIndustry("")).toBeNull();
    expect(safeIndustry(undefined)).toBeNull();
    expect(safeIndustry("<script>")).toBeNull();
  });
});

describe("vocabulary alignment", () => {
  it("pack industries trigger the intended portal vocabulary", () => {
    expect(vocabFor("Dental").customer).toBe("patient");
    expect(vocabFor("Law").appointment).toBe("consultation");
    expect(vocabFor("Salon & beauty").customer).toBe("client");
    expect(vocabFor("Med spa").customer).toBe("client");
  });
});
