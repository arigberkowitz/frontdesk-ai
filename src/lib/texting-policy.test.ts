import { describe, expect, it } from "vitest";
import { decideText, inQuietHours, nextLocalHour } from "./texting-policy";

const NY = { textingEnabled: true, quietStartHour: 21, quietEndHour: 8, timeZone: "America/New_York" };

describe("texting policy", () => {
  it("quiet window crossing midnight", () => {
    expect(inQuietHours(22, 21, 8)).toBe(true);
    expect(inQuietHours(3, 21, 8)).toBe(true);
    expect(inQuietHours(8, 21, 8)).toBe(false);
    expect(inQuietHours(12, 21, 8)).toBe(false);
    expect(inQuietHours(12, 12, 12)).toBe(false);
    expect(inQuietHours(13, 12, 14)).toBe(true);
  });

  it("sends during the day", () => {
    expect(decideText(NY, { now: new Date("2026-11-04T15:00:00Z") })).toEqual({ action: "send" }); // 10 AM ET
  });

  it("queues at 11 PM local until 8 AM local (business's zone, not UTC)", () => {
    const d = decideText(NY, { now: new Date("2026-11-05T04:00:00Z") }); // 11 PM ET
    expect(d).toEqual({ action: "queue", sendAfter: new Date("2026-11-05T13:00:00Z") });
    const la = decideText({ ...NY, timeZone: "America/Los_Angeles" }, { now: new Date("2026-11-05T04:00:00Z") }); // 8 PM PT
    expect(la).toEqual({ action: "send" });
  });

  it("handles the DST change (8 AM local after fall-back)", () => {
    expect(nextLocalHour(new Date("2026-11-01T04:30:00Z"), "America/New_York", 8)).toEqual(new Date("2026-11-01T13:00:00Z"));
  });

  it("texting off drops automated texts", () => {
    expect(decideText({ ...NY, textingEnabled: false }, { now: new Date("2026-11-04T15:00:00Z") })).toEqual({ action: "drop", reason: "texting_off" });
  });

  it("manual owner texts always send", () => {
    const night = new Date("2026-11-05T04:00:00Z");
    expect(decideText(NY, { now: night, manual: true })).toEqual({ action: "send" });
    expect(decideText({ ...NY, textingEnabled: false }, { now: night, manual: true })).toEqual({ action: "send" });
  });
});
