import { describe, expect, it } from "vitest";
import { spokenDateTime } from "./slot-label";

describe("spokenDateTime", () => {
  it("names the right weekday in the business's zone (Oct 15 2026 is a Thursday)", () => {
    expect(spokenDateTime("2026-10-15T17:00:00.000Z", "America/Los_Angeles")).toBe(
      "Thursday, October 15, 2026 at 10:00 AM",
    );
  });
  it("uses the local date when UTC has already rolled over", () => {
    // 9 PM PT Thu = 04:00 UTC Fri.
    expect(spokenDateTime("2026-10-16T04:00:00.000Z", "America/Los_Angeles")).toMatch(/^Thursday, October 15/);
    expect(spokenDateTime("2026-10-16T04:00:00.000Z", "America/New_York")).toMatch(/^Friday, October 16/);
  });
});
