import { describe, expect, it } from "vitest";
import {
  addBlocked,
  isBlocked,
  normalizeForBlock,
  removeBlocked,
  spamCandidates,
} from "./spam";

describe("matching a blocked number", () => {
  it("ignores every way a number can be written", () => {
    const blocked = ["+1 (415) 555-0134"];
    for (const variant of [
      "4155550134",
      "+14155550134",
      "1-415-555-0134",
      "(415) 555.0134",
      "415 555 0134",
    ]) {
      expect(isBlocked(variant, blocked), variant).toBe(true);
    }
  });

  it("doesn't block a different number that happens to share digits", () => {
    expect(isBlocked("4155550135", ["4155550134"])).toBe(false);
  });

  it("treats anything too short to be a phone number as not blocked", () => {
    // Withheld/unknown callers arrive as junk. Blocking on those would block
    // every anonymous caller at once, including real ones.
    expect(isBlocked("anonymous", ["4155550134"])).toBe(false);
    expect(isBlocked("", ["4155550134"])).toBe(false);
    expect(isBlocked(null, ["4155550134"])).toBe(false);
    expect(normalizeForBlock("911")).toBeNull();
  });
});

describe("editing the list", () => {
  it("adds newest first and never duplicates a number in another format", () => {
    let list: string[] = [];
    list = addBlocked("(415) 555-0134", list);
    list = addBlocked("+1 415 555 0134", list);
    expect(list).toEqual(["4155550134"]);

    list = addBlocked("628-500-7282", list);
    expect(list[0]).toBe("6285007282");
    expect(list).toHaveLength(2);
  });

  it("ignores junk instead of storing it", () => {
    expect(addBlocked("unknown", [])).toEqual([]);
  });

  it("removes regardless of formatting", () => {
    expect(removeBlocked("+1 (415) 555-0134", ["4155550134", "6285007282"])).toEqual([
      "6285007282",
    ]);
  });
});

describe("who to offer for blocking", () => {
  const at = (iso: string) => new Date(iso);

  it("suggests a number that spammed twice, not once", () => {
    const calls = [
      { fromNumber: "4155550100", outcome: "spam", startAt: at("2026-08-01T10:00:00Z") },
      { fromNumber: "4155550100", outcome: "spam", startAt: at("2026-08-02T10:00:00Z") },
      { fromNumber: "4155550101", outcome: "spam", startAt: at("2026-08-02T11:00:00Z") },
    ];
    const out = spamCandidates(calls, []);
    expect(out).toHaveLength(1);
    expect(out[0].phone).toBe("4155550100");
    expect(out[0].calls).toBe(2);
    expect(out[0].lastAt).toEqual(at("2026-08-02T10:00:00Z"));
  });

  // Blocking a real customer over one misclassified call is far worse than
  // letting one more robocall through, so a single call is never suggested.
  it("never suggests a number from one call alone", () => {
    const calls = [{ fromNumber: "4155550100", outcome: "spam", startAt: at("2026-08-01T10:00:00Z") }];
    expect(spamCandidates(calls, [])).toHaveLength(0);
  });

  it("ignores calls that weren't spam, however often they happen", () => {
    const calls = Array.from({ length: 5 }, () => ({
      fromNumber: "4155550100",
      outcome: "booked",
      startAt: at("2026-08-01T10:00:00Z"),
    }));
    expect(spamCandidates(calls, [])).toHaveLength(0);
  });

  it("doesn't suggest what's already blocked", () => {
    const calls = [
      { fromNumber: "+1 415 555 0100", outcome: "spam", startAt: at("2026-08-01T10:00:00Z") },
      { fromNumber: "+1 415 555 0100", outcome: "spam", startAt: at("2026-08-02T10:00:00Z") },
    ];
    expect(spamCandidates(calls, ["(415) 555-0100"])).toHaveLength(0);
  });

  it("puts the worst offender first", () => {
    const calls = [
      ...Array.from({ length: 4 }, () => ({
        fromNumber: "4155550100",
        outcome: "spam",
        startAt: at("2026-08-01T10:00:00Z"),
      })),
      ...Array.from({ length: 2 }, () => ({
        fromNumber: "4155550101",
        outcome: "spam",
        startAt: at("2026-08-01T10:00:00Z"),
      })),
    ];
    const out = spamCandidates(calls, []);
    expect(out.map((c) => c.phone)).toEqual(["4155550100", "4155550101"]);
  });
});
