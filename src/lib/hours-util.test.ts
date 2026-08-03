import { describe, expect, it } from "vitest";
import { isAfterHours, parseInClientTimezone, wallClockToInstant } from "./hours-util";

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

/**
 * The agent hears "nine on Sunday" and books it. Twice a year the arithmetic
 * that turns those words into an instant used to slip by an hour, in the
 * direction nobody notices until a customer is standing in an empty lobby.
 */
describe("parseInClientTimezone across a DST boundary", () => {
  const LA = "America/Los_Angeles";
  const localHour = (d: Date, tz: string) =>
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", hour12: false }).format(d);

  it("reads a naive datetime as wall-clock time in the client's zone", () => {
    // 2026-07-23 is comfortably inside PDT (-07:00).
    expect(parseInClientTimezone("2026-07-23T14:00:00", LA)?.toISOString()).toBe(
      "2026-07-23T21:00:00.000Z",
    );
  });

  it("still means 9 AM on the morning the clocks spring forward", () => {
    // 8 Mar 2026, 2 AM PST → 3 AM PDT. The one-pass version probed the offset
    // at 09:00 UTC — which is 01:00 PST, still -08:00 — and produced 17:00Z,
    // i.e. 10 AM local. An hour late, silently.
    const at = parseInClientTimezone("2026-03-08T09:00:00", LA);
    expect(at?.toISOString()).toBe("2026-03-08T16:00:00.000Z");
    expect(localHour(at!, LA)).toBe("09");
  });

  it("holds through the whole ambiguous morning, not just one lucky hour", () => {
    for (const h of ["03", "04", "05", "06", "07", "08", "09", "10"]) {
      const at = parseInClientTimezone(`2026-03-08T${h}:30:00`, LA);
      expect(localHour(at!, LA)).toBe(h);
    }
  });

  it("survives the autumn repeat, where the same wall clock happens twice", () => {
    // 1 Nov 2026: 1 AM occurs at -07:00 and again at -08:00. Either is a
    // defensible reading; what matters is that we return 1 AM local, not 2.
    const at = parseInClientTimezone("2026-11-01T01:30:00", LA);
    expect(localHour(at!, LA)).toBe("01");
  });

  it("a time that does not exist resolves forward, never back into yesterday", () => {
    // 2:30 AM never happens on 8 Mar. Landing on 3:30 AM is the kind thing to
    // do; landing on 1:30 AM would move an appointment earlier than requested.
    const at = parseInClientTimezone("2026-03-08T02:30:00", LA);
    expect(localHour(at!, LA)).toBe("03");
  });

  it("trusts an explicit offset instead of reinterpreting it", () => {
    expect(parseInClientTimezone("2026-03-08T09:00:00-05:00", LA)?.toISOString()).toBe(
      "2026-03-08T14:00:00.000Z",
    );
    expect(parseInClientTimezone("2026-03-08T14:00:00Z", LA)?.toISOString()).toBe(
      "2026-03-08T14:00:00.000Z",
    );
  });

  it("rejects junk rather than booking the epoch", () => {
    expect(parseInClientTimezone("", LA)).toBeNull();
    expect(parseInClientTimezone("next tuesday", LA)).toBeNull();
  });
});

describe("wallClockToInstant", () => {
  it("agrees with parseInClientTimezone — one definition, used by both", () => {
    // zonedTime() in google-calendar delegates here, so slot generation and
    // booking can't drift apart.
    const viaParse = parseInClientTimezone("2026-03-08T09:00:00", "America/Los_Angeles");
    const viaWall = wallClockToInstant("America/Los_Angeles", 2026, 2, 8, 9, 0);
    expect(viaWall.toISOString()).toBe(viaParse?.toISOString());
  });

  it("handles a zone on a half-hour offset", () => {
    // Kolkata is +05:30 year-round; a naive minutes-only implementation drops
    // the :30 and books half an hour off.
    expect(wallClockToInstant("Asia/Kolkata", 2026, 6, 23, 14, 0).toISOString()).toBe(
      "2026-07-23T08:30:00.000Z",
    );
  });

  it("handles a southern-hemisphere transition, where DST runs the other way", () => {
    // Sydney falls back on 5 Apr 2026 (AEDT +11 → AEST +10).
    const at = wallClockToInstant("Australia/Sydney", 2026, 3, 5, 9, 0);
    expect(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "Australia/Sydney",
        hour: "2-digit",
        hour12: false,
      }).format(at),
    ).toBe("09");
  });
});
