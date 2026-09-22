import { describe, it, expect } from "vitest";
import { LIVE_MAX_AGE_MS, elapsed, isLive } from "./live-call";

const NOW = new Date("2026-09-22T18:00:00Z");

describe("isLive", () => {
  it("an open row that started recently is live", () => {
    expect(isLive({ id: "c", startAt: new Date(NOW.getTime() - 40_000), endAt: null }, NOW)).toBe(true);
  });
  it("a row with an end time is over", () => {
    expect(isLive({ id: "c", startAt: new Date(NOW.getTime() - 40_000), endAt: NOW }, NOW)).toBe(false);
  });
  it("a row open for over an hour is a lost end event, not a caller", () => {
    expect(isLive({ id: "c", startAt: new Date(NOW.getTime() - LIVE_MAX_AGE_MS - 1), endAt: null }, NOW)).toBe(false);
  });
  it("no start time is not live", () => {
    expect(isLive({ id: "c", startAt: null, endAt: null }, NOW)).toBe(false);
  });
});

describe("elapsed", () => {
  it("formats like a phone", () => {
    expect(elapsed(new Date(NOW.getTime() - 42_000), NOW)).toBe("0:42");
    expect(elapsed(new Date(NOW.getTime() - 725_000), NOW)).toBe("12:05");
  });
  it("never goes negative on clock skew", () => {
    expect(elapsed(new Date(NOW.getTime() + 5_000), NOW)).toBe("0:00");
  });
});
