import { describe, expect, it } from "vitest";
import { openDaysBetween } from "@/lib/quiet-line";

const LA = "America/Los_Angeles";
const WEEKDAYS = new Set([1, 2, 3, 4, 5]);
const EVERY_DAY = new Set([0, 1, 2, 3, 4, 5, 6]);

/** 2026-08-03 is a Monday. All instants are 5pm PT so the day is unambiguous. */
const at = (iso: string) => Date.parse(iso);
const MON = at("2026-08-04T00:00:00Z"); // Mon Aug 3, 5pm PT
const TUE = at("2026-08-05T00:00:00Z");
const WED = at("2026-08-06T00:00:00Z");
const FRI = at("2026-08-08T00:00:00Z"); // Fri Aug 7, 5pm PT
const NEXT_MON = at("2026-08-11T00:00:00Z"); // Mon Aug 10

describe("openDaysBetween", () => {
  it("counts nothing on the day of the last call", () => {
    expect(openDaysBetween(MON, MON, LA, WEEKDAYS)).toBe(0);
  });

  it("counts one open day after a single day's gap", () => {
    expect(openDaysBetween(MON, TUE, LA, WEEKDAYS)).toBe(1);
    expect(openDaysBetween(MON, WED, LA, WEEKDAYS)).toBe(2);
  });

  // The reason this isn't just an hour threshold: a Mon–Fri business going
  // quiet from Friday evening to Monday morning is ~60 hours and zero open
  // days. Alerting on that would cry wolf every single weekend.
  it("does not count the weekend for a Mon–Fri business", () => {
    expect(openDaysBetween(FRI, NEXT_MON, LA, WEEKDAYS)).toBe(1);
  });

  it("does count the weekend for a business open seven days", () => {
    expect(openDaysBetween(FRI, NEXT_MON, LA, EVERY_DAY)).toBe(3);
  });

  it("respects the business's zone when deciding which day it is", () => {
    // 2026-08-10T05:00Z is Monday in New York but still Sunday evening in LA,
    // so a Mon–Fri shop in LA hasn't opened yet.
    const sundayNightPT = at("2026-08-10T05:00:00Z");
    expect(openDaysBetween(FRI, sundayNightPT, LA, WEEKDAYS)).toBe(0);
    expect(openDaysBetween(FRI, sundayNightPT, "America/New_York", WEEKDAYS)).toBe(1);
  });
});
