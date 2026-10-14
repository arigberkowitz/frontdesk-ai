import { describe, it, expect } from "vitest";
import { resolveDateRange } from "./date-range";

const TZ = "America/Los_Angeles";
// Tue Oct 13 2026, 11:50 PM PDT — already Wednesday in UTC.
const NOW = new Date("2026-10-14T06:50:00Z");

describe("resolveDateRange", () => {
  it("'Thursday' late Tuesday night PT is Thu Oct 15 in PT, not the UTC day", () => {
    const r = resolveDateRange("Thursday", TZ, NOW);
    expect(r.start.toISOString()).toBe("2026-10-15T07:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-10-16T07:00:00.000Z");
    expect(r.matched).toBe(true);
  });
  it("tomorrow is Wednesday PT", () => {
    expect(resolveDateRange("tomorrow", TZ, NOW).start.toISOString()).toBe("2026-10-14T07:00:00.000Z");
  });
  it("today is clamped to now", () => {
    const r = resolveDateRange("today", TZ, NOW);
    expect(r.start).toBe(NOW);
    expect(r.end.toISOString()).toBe("2026-10-14T07:00:00.000Z");
  });
  it("same weekday means today; 'next' pushes a week", () => {
    expect(resolveDateRange("tuesday", TZ, NOW).start).toBe(NOW);
    expect(resolveDateRange("next tuesday", TZ, NOW).start.toISOString()).toBe("2026-10-20T07:00:00.000Z");
  });
  it("explicit dates", () => {
    expect(resolveDateRange("2026-10-15", TZ, NOW).start.toISOString()).toBe("2026-10-15T07:00:00.000Z");
    expect(resolveDateRange("Oct 15th", TZ, NOW).start.toISOString()).toBe("2026-10-15T07:00:00.000Z");
    expect(resolveDateRange("10/15", TZ, NOW).start.toISOString()).toBe("2026-10-15T07:00:00.000Z");
  });
  it("next week starts Monday", () => {
    const r = resolveDateRange("next week", TZ, NOW);
    expect(r.start.toISOString()).toBe("2026-10-19T07:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-10-26T07:00:00.000Z");
  });
  it("falls back to now → +7 days for empty or unknown text", () => {
    for (const v of [undefined, "", "whenever works"]) {
      const r = resolveDateRange(v, TZ, NOW);
      expect(r.matched).toBe(false);
      expect(r.start).toBe(NOW);
      expect(r.end.getTime() - NOW.getTime()).toBe(7 * 86_400_000);
    }
  });
});
