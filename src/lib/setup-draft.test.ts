import { describe, expect, it } from "vitest";
import { INDUSTRIES } from "@/config/options";
import { packForIndustry } from "@/config/starter-packs";
import { hasAiDisclosure } from "@/lib/prompt";
import {
  buildDraft,
  formatClock,
  isDraftField,
  serviceDescriptionFor,
  summarizeHours,
  type DraftFacts,
} from "./setup-draft";

const weekdays = [1, 2, 3, 4, 5].map((dayOfWeek) => ({
  dayOfWeek,
  isClosed: false,
  openTime: "08:00",
  closeTime: "17:30",
}));

const base: DraftFacts = {
  businessName: "Harbor View Plumbing",
  agentName: null,
  industry: "Plumbing",
  services: [
    { name: "Drain cleaning", priceCents: null },
    { name: "Water heater install", priceCents: null },
  ],
  hours: weekdays,
  calendarConnected: true,
  languages: ["en"],
  canTransfer: true,
  handoffMode: "always",
  humanHandoffEnabled: true,
};

const text = (field: Parameters<typeof buildDraft>[0], facts: DraftFacts = base) => {
  const r = buildDraft(field, facts);
  if (!r.ok) throw new Error(r.error);
  return r.text;
};

describe("formatClock / summarizeHours", () => {
  it("formats 24h times the way people say them", () => {
    expect(formatClock("09:00")).toBe("9 AM");
    expect(formatClock("17:30")).toBe("5:30 PM");
    expect(formatClock("00:00")).toBe("12 AM");
    expect(formatClock("12:00")).toBe("12 PM");
    expect(formatClock("9am")).toBeNull();
    expect(formatClock(null)).toBeNull();
  });

  it("joins runs of days with the same hours and skips closed days", () => {
    const hours = [
      ...weekdays,
      { dayOfWeek: 6, isClosed: false, openTime: "09:00", closeTime: "13:00" },
      { dayOfWeek: 0, isClosed: true, openTime: null, closeTime: null },
    ];
    expect(summarizeHours(hours)).toBe("Mon–Fri 8 AM–5:30 PM; Sat 9 AM–1 PM");
  });

  it("keeps different hours on a weekday separate and handles a single day", () => {
    const hours = [
      { dayOfWeek: 1, isClosed: false, openTime: "09:00", closeTime: "17:00" },
      { dayOfWeek: 2, isClosed: false, openTime: "10:00", closeTime: "17:00" },
      { dayOfWeek: 3, isClosed: false, openTime: "10:00", closeTime: "17:00" },
    ];
    expect(summarizeHours(hours)).toBe("Mon 9 AM–5 PM; Tue–Wed 10 AM–5 PM");
  });

  it("returns null when nothing is open or the times are unusable", () => {
    expect(summarizeHours([])).toBeNull();
    expect(
      summarizeHours([{ dayOfWeek: 1, isClosed: false, openTime: null, closeTime: "17:00" }]),
    ).toBeNull();
  });
});

describe("greeting", () => {
  it("names the business and says it's an AI", () => {
    const g = text("greeting");
    expect(g).toContain("Harbor View Plumbing");
    expect(g).toContain("Riley");
    expect(hasAiDisclosure(g)).toBe(true);
  });

  it("uses the receptionist's own name when set", () => {
    expect(text("greeting", { ...base, agentName: "Sam" })).toContain("This is Sam");
  });

  it("opens in Spanish for a Spanish-first business, still saying it's an AI", () => {
    const g = text("greeting", { ...base, languages: ["es", "en"] });
    expect(g).toMatch(/^¡Hola, gracias por llamar a Harbor View Plumbing!/);
    expect(g).toContain("inteligencia artificial");
  });

  it("asks something that fits the kind of business", () => {
    expect(text("greeting", { ...base, industry: "Dental" })).toContain("schedule a visit");
    expect(text("greeting", { ...base, industry: "Salon & beauty" })).toContain("book an appointment");
    expect(text("greeting", { ...base, industry: null })).toContain("How can I help you today?");
  });
});

describe("what the receptionist can say", () => {
  it("lists the services and keeps the industry's safety rules", () => {
    const g = text("agentGuidance");
    expect(g).toContain("Drain cleaning and Water heater install");
    expect(g).toMatch(/shut off the main water valve/);
    expect(g).toMatch(/smell gas/);
  });

  it("keeps the medical industries working", () => {
    expect(text("agentGuidance", { ...base, industry: "Dental" })).toMatch(/911/);
    expect(text("agentGuidance", { ...base, industry: "Veterinary" })).toMatch(/emergency/i);
    expect(text("agentGuidance", { ...base, industry: "Med spa" })).toMatch(/medical advice/);
  });

  it("says not to quote prices when none are set, and to use listed ones when they are", () => {
    expect(text("agentGuidance")).toContain("Don't quote prices.");
    const priced = text("agentGuidance", {
      ...base,
      services: [{ name: "Haircut", priceCents: 4500 }],
    });
    expect(priced).toContain("Only quote a price that's listed");
    // The draft never states a price itself.
    expect(priced).not.toMatch(/\$\s?\d|45/);
  });

  it("follows the handoff setup", () => {
    expect(text("agentGuidance")).toContain("offer to connect them to the team");
    expect(text("agentGuidance", { ...base, handoffMode: "open_hours" })).toContain(
      "while the office is open",
    );
    for (const off of [
      { canTransfer: false },
      { handoffMode: "never" as const },
      { humanHandoffEnabled: false },
    ]) {
      const g = text("agentGuidance", { ...base, ...off });
      expect(g).toContain("take a message and say the team will call back");
      expect(g).not.toContain("offer to connect");
    }
  });

  it("mentions languages only when there's more than one", () => {
    expect(text("agentGuidance")).not.toMatch(/Speak /);
    expect(text("agentGuidance", { ...base, languages: ["en", "es"] })).toContain(
      "Speak English and Spanish, whichever the caller uses.",
    );
  });

  it("is bullet lines, with no duplicates", () => {
    const lines = text("agentGuidance").split("\n");
    expect(lines.every((l) => l.startsWith("• "))).toBe(true);
    expect(new Set(lines).size).toBe(lines.length);
  });
});

describe("booking rules", () => {
  it("uses the real services and hours", () => {
    const b = text("bookingInstructions");
    expect(b).toContain("Book these services: Drain cleaning and Water heater install.");
    expect(b).toContain("Only offer times when we're open (Mon–Fri 8 AM–5:30 PM).");
  });

  it("offers calendar times when a calendar is connected", () => {
    expect(text("bookingInstructions")).toContain("Offer the next open times on the calendar.");
  });

  it("doesn't promise times when no calendar is connected", () => {
    const b = text("bookingInstructions", { ...base, calendarConnected: false });
    expect(b).toContain("The calendar isn't connected yet, so don't promise a time.");
    expect(b).not.toContain("Offer the next open times");
  });

  it("drops the generic 'offer the next openings' sentence for an unmatched business", () => {
    const b = text("bookingInstructions", { ...base, industry: null, calendarConnected: false });
    expect(b).not.toMatch(/Offer the next available/);
    expect(b).toContain("read the appointment back to them");
  });

  it("leaves out lines it has no facts for", () => {
    const b = text("bookingInstructions", { ...base, services: [], hours: [] });
    expect(b).not.toContain("Book these services");
    expect(b).not.toContain("Only offer times");
  });

  it("collects what this kind of business needs", () => {
    expect(text("bookingInstructions")).toMatch(/service address/);
    expect(text("bookingInstructions", { ...base, industry: "Auto repair" })).toMatch(/year, make, and model/);
  });
});

describe("never invents anything", () => {
  it("has no prices, deposits or [placeholders] for any kind of business", () => {
    for (const industry of [...INDUSTRIES, null]) {
      for (const calendarConnected of [true, false]) {
        const facts = { ...base, industry, calendarConnected, languages: ["en", "es"] };
        for (const field of ["greeting", "agentGuidance", "bookingInstructions"] as const) {
          const t = text(field, facts);
          expect(t.length, `${industry}/${field}`).toBeGreaterThan(20);
          expect(t, `${industry}/${field}`).not.toMatch(/\$|\[|\]|deposit|guarantee/i);
        }
      }
    }
  });

  it("always fits the save form's limits, even with long names", () => {
    const long = Array.from({ length: 40 }, (_, i) => ({ name: `Service ${"x".repeat(100)} ${i}`, priceCents: null }));
    const facts = { ...base, businessName: "B".repeat(120), services: long };
    expect(text("greeting", facts).length).toBeLessThanOrEqual(1000);
    expect(text("agentGuidance", facts).length).toBeLessThanOrEqual(4000);
    expect(text("bookingInstructions", facts).length).toBeLessThanOrEqual(4000);
  });

  it("keeps every industry's own safety rules from its starter pack", () => {
    for (const industry of INDUSTRIES) {
      const pack = packForIndustry(industry);
      const first = pack.guardrails.split(/(?<=[.!?])\s+(?=[A-Z])/)[3] ?? "";
      if (first && !first.includes("'")) {
        expect(text("agentGuidance", { ...base, industry }), industry).toContain(first.trim());
      }
    }
  });
});

describe("service descriptions", () => {
  it("matches a starter service by name, ignoring case and punctuation", () => {
    expect(serviceDescriptionFor("Dental", "teeth whitening")).toMatch(/whitening session/);
    expect(serviceDescriptionFor("Dental", "  Cleaning & Checkup! ")).toMatch(/hygiene cleaning/);
  });

  it("falls back to another kind's service of the same name", () => {
    expect(serviceDescriptionFor("Plumbing", "Estimate")).toMatch(/estimate/i);
  });

  it("gives nothing for a name it doesn't know", () => {
    expect(serviceDescriptionFor("Dental", "Hot stone massage")).toBeNull();
    const miss = buildDraft("serviceDescription", base, { serviceName: "Hot stone massage" });
    expect(miss.ok).toBe(false);
    const noName = buildDraft("serviceDescription", base, { serviceName: "  " });
    expect(noName).toMatchObject({ ok: false, error: expect.stringMatching(/service name first/) });
  });

  it("returns the text with a reminder to check it", () => {
    const r = buildDraft("serviceDescription", { ...base, industry: "Dental" }, { serviceName: "Teeth whitening" });
    expect(r).toMatchObject({ ok: true, note: expect.stringMatching(/Check it/) });
  });
});

describe("isDraftField", () => {
  it("only accepts the four boxes", () => {
    expect(isDraftField("greeting")).toBe(true);
    expect(isDraftField("serviceDescription")).toBe(true);
    expect(isDraftField("faq")).toBe(false);
    expect(isDraftField(undefined)).toBe(false);
  });
});
