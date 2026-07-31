import { describe, expect, it } from "vitest";
import {
  tzDateLong,
  tzDateTime,
  tzDayKey,
  tzTime,
  tzTimeShort,
  tzTodayKey,
  zoneAbbrev,
} from "@/lib/tz";

const LA = "America/Los_Angeles";
const NY = "America/New_York";

/**
 * 2026-08-05T05:30:00Z. Deliberately picked so the three clocks disagree about
 * what DAY it is: already Wednesday in UTC, 1:30am Wednesday in New York, but
 * still 10:30pm Tuesday in Los Angeles. Every bug these helpers exist to prevent
 * shows up on an instant like this one.
 */
const LATE = "2026-08-05T05:30:00.000Z";

describe("tz helpers", () => {
  it("renders the time in the business's zone, not the runtime's", () => {
    expect(tzTime(LATE, LA)).toBe("10:30 PM");
    expect(tzTime(LATE, NY)).toBe("1:30 AM");
  });

  // The calendar-bucketing bug: keying off the viewer's local date slid a
  // late-evening booking onto the following day's square.
  it("buckets an instant onto the day it falls on locally", () => {
    expect(tzDayKey(LATE, LA)).toBe("2026-08-04");
    expect(tzDayKey(LATE, NY)).toBe("2026-08-05");
  });

  it("accepts Date, string, and epoch millis alike", () => {
    const ms = Date.parse(LATE);
    expect(tzDayKey(new Date(ms), LA)).toBe("2026-08-04");
    expect(tzDayKey(ms, LA)).toBe("2026-08-04");
    expect(tzDayKey(LATE, LA)).toBe("2026-08-04");
  });

  it("tracks daylight saving rather than a fixed offset", () => {
    // Los Angeles is UTC-7 in August and UTC-8 in January.
    expect(zoneAbbrev(LA, new Date("2026-08-04T20:00:00Z"))).toBe("PDT");
    expect(zoneAbbrev(LA, new Date("2026-01-04T20:00:00Z"))).toBe("PST");
  });

  it("keeps the same wall-clock hour across a DST change", () => {
    // 9am local on either side of the November 1 2026 fallback. If these helpers
    // leaked a fixed offset, one of them would read 8am or 10am.
    expect(tzTime("2026-10-30T16:00:00.000Z", LA)).toBe("9:00 AM"); // PDT, UTC-7
    expect(tzTime("2026-11-02T17:00:00.000Z", LA)).toBe("9:00 AM"); // PST, UTC-8
  });

  it("formats the long and combined forms in the business's zone", () => {
    expect(tzDateTime(LATE, LA)).toBe("Tue, Aug 4, 2026 · 10:30 PM");
    expect(tzDateLong(LATE, LA)).toBe("Tuesday, August 4, 2026");
    expect(tzDateLong(LATE, NY)).toBe("Wednesday, August 5, 2026");
  });

  it("drops the meridiem for dense calendar cells", () => {
    expect(tzTimeShort(LATE, LA)).toBe("10:30");
    expect(tzTimeShort("2026-08-04T16:00:00.000Z", LA)).toBe("9:00");
  });

  it("resolves today against the business's zone", () => {
    expect(tzTodayKey(LA, new Date(LATE))).toBe("2026-08-04");
    expect(tzTodayKey(NY, new Date(LATE))).toBe("2026-08-05");
  });
});
