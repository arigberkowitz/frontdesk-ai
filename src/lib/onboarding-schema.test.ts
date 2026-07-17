import { describe, expect, it } from "vitest";
import { dayNameToIndex, profileSchema } from "./onboarding";

/** The zod guard between Claude's output and the database. */

describe("profileSchema", () => {
  it("accepts a well-formed profile", () => {
    const parsed = profileSchema.safeParse({
      summary: "A plumber.",
      tone: "friendly",
      address: "",
      phone: "",
      services: [{ name: "Drain cleaning", durationMin: 60, priceDollars: 150, description: "" }],
      hours: [{ day: "Monday", open: "09:00", close: "17:00", closed: false }],
      faq: [{ question: "Parking?", answer: "Free lot." }],
    });
    expect(parsed.success).toBe(true);
  });

  it("clamps hallucinated durations and negative prices instead of failing", () => {
    const parsed = profileSchema.parse({
      services: [{ name: "X", durationMin: 99999, priceDollars: -5, description: "" }],
    });
    expect(parsed.services[0].durationMin).toBe(30); // catch() default
    expect(parsed.services[0].priceDollars).toBe(0);
  });

  it("drops FAQ entries with empty question/answer", () => {
    const parsed = profileSchema.safeParse({
      faq: [{ question: "", answer: "orphan" }],
    });
    expect(parsed.success).toBe(false); // min(1) rejects — caller falls back safely
  });

  it("defaults everything when Claude returns an empty object", () => {
    const parsed = profileSchema.parse({});
    expect(parsed.services).toEqual([]);
    expect(parsed.hours).toEqual([]);
    expect(parsed.faq).toEqual([]);
  });
});

describe("dayNameToIndex", () => {
  it("maps names case-insensitively", () => {
    expect(dayNameToIndex("sunday")).toBe(0);
    expect(dayNameToIndex("Saturday")).toBe(6);
  });
  it("returns -1 for junk (caller skips the row)", () => {
    expect(dayNameToIndex("Funday")).toBe(-1);
  });
});
