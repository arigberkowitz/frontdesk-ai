import { describe, expect, it } from "vitest";
import { countOnDay, dayKeyInZone, greetingForHour, heroStatus, hourInZone } from "./portal-hero";

describe("portal hero helpers", () => {
  it("greets by business-local time of day", () => {
    expect(greetingForHour(8)).toBe("Good morning");
    expect(greetingForHour(13)).toBe("Good afternoon");
    expect(greetingForHour(20)).toBe("Good evening");
    expect(greetingForHour(2)).toBe("Good evening");
  });

  it("reads the hour in the business timezone, not the server's", () => {
    const at = new Date("2026-09-30T15:30:00Z");
    expect(hourInZone(at, "America/New_York")).toBe(11);
    expect(hourInZone(at, "America/Los_Angeles")).toBe(8);
    expect(hourInZone(at, "Not/AZone")).toBe(at.getHours());
  });

  it("counts things that happened today in the business timezone", () => {
    const now = new Date("2026-10-01T02:00:00Z"); // Sep 30, 10pm in New York
    expect(dayKeyInZone(now, "America/New_York")).toBe("2026-09-30");
    const dates = [
      new Date("2026-09-30T14:00:00Z"), // today in NY
      new Date("2026-10-01T01:00:00Z"), // today in NY (9pm)
      new Date("2026-09-29T14:00:00Z"), // yesterday
      null,
    ];
    expect(countOnDay(dates, now, "America/New_York")).toBe(2);
  });

  it("picks paused, live or finish-setup", () => {
    expect(heroStatus({ clientStatus: "paused", aiLive: true, setupDone: 9, setupTotal: 9 }).tone).toBe("paused");
    expect(heroStatus({ clientStatus: "trial", aiLive: true, setupDone: 7, setupTotal: 9 }).tone).toBe("live");
    const s = heroStatus({ clientStatus: "draft", aiLive: false, setupDone: 3, setupTotal: 9 });
    expect(s.tone).toBe("setup");
    expect(s.label).toContain("3 of 9");
  });
});
