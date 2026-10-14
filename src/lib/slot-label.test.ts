import { describe, it, expect } from "vitest";
import { localSlot } from "./slot-label";

describe("localSlot", () => {
  it("renders 16:00Z as 9 AM Wednesday Pacific, not 4 PM", () => {
    const s = localSlot("2026-10-14T16:00:00.000Z", "America/Los_Angeles");
    expect(s.start).toBe("2026-10-14T09:00:00-07:00");
    expect(s.label).toBe("Wednesday, October 14 at 9:00 AM");
  });
  it("keeps the local date when UTC has rolled to the next day", () => {
    const s = localSlot("2026-10-16T00:30:00.000Z", "America/Los_Angeles");
    expect(s.start).toBe("2026-10-15T17:30:00-07:00");
    expect(s.label).toMatch(/^Thursday, October 15/);
  });
  it("handles standard time and UTC zones", () => {
    expect(localSlot("2026-12-03T17:00:00Z", "America/Los_Angeles").start).toBe("2026-12-03T09:00:00-08:00");
    expect(localSlot("2026-12-03T17:00:00Z", "UTC").start).toBe("2026-12-03T17:00:00+00:00");
  });
  it("round-trips to the same instant", () => {
    const iso = "2026-10-15T17:00:00.000Z";
    expect(new Date(localSlot(iso, "America/New_York").start).toISOString()).toBe(iso);
  });
});
