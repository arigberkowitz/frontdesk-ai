import { describe, expect, it } from "vitest";
import { isAfterHours } from "./hours-util";

/** After-hours drives the "saves" metric and digest copy — timezone-sensitive. */

const HOURS = [
  { dayOfWeek: 1, isClosed: false, openTime: "09:00", closeTime: "17:00" }, // Mon
  { dayOfWeek: 0, isClosed: true, openTime: null, closeTime: null }, // Sun
];

// 2026-01-05 is a Monday.
const TZ = "America/New_York";

describe("isAfterHours", () => {
  it("open hours on an open day → not after hours", () => {
    // 15:00 UTC = 10:00 EST Monday
    expect(isAfterHours(new Date("2026-01-05T15:00:00Z"), TZ, HOURS)).toBe(false);
  });

  it("evening on an open day → after hours", () => {
    // 23:30 UTC = 18:30 EST Monday (closes 17:00)
    expect(isAfterHours(new Date("2026-01-05T23:30:00Z"), TZ, HOURS)).toBe(true);
  });

  it("closed day → after hours", () => {
    // Sunday 2026-01-04, 17:00 UTC = noon EST
    expect(isAfterHours(new Date("2026-01-04T17:00:00Z"), TZ, HOURS)).toBe(true);
  });

  it("no hours configured → never flags", () => {
    expect(isAfterHours(new Date("2026-01-05T03:00:00Z"), TZ, [])).toBe(false);
  });

  it("timezone matters: same instant, different verdicts", () => {
    // 2026-01-05T21:30:00Z = 16:30 EST (open) but 13:30 PST — also open;
    // use 22:30Z: 17:30 EST (closed) vs 14:30 PST (open).
    const at = new Date("2026-01-05T22:30:00Z");
    expect(isAfterHours(at, "America/New_York", HOURS)).toBe(true);
    expect(isAfterHours(at, "America/Los_Angeles", HOURS)).toBe(false);
  });
});
