import { describe, expect, it } from "vitest";
import {
  MAX_TURNED_AWAY,
  summarizeTurnedAway,
  turnedAwayLine,
  addBlocked,
  isBlocked,
  normalizeForBlock,
  removeBlocked,
  spamCandidates,
  screenInboundCaller,
  isSilentOrShort,
  silentRepeatCandidates,
  autoRejectedNumbers,
  AUTO_REJECT_SPAM_CALLS,
  SILENT_CALL_MAX_SEC,
  SILENT_REPEAT_MIN_CALLS,
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

describe("screenInboundCaller — turn a call away before the AI answers", () => {
  const spam = { outcome: "spam", hasContact: false };
  it("rejects a number the owner blocked, however it's written", () => {
    expect(screenInboundCaller("+1 (415) 555-0134", ["4155550134"], [])).toEqual({ reject: true, reason: "blocked" });
  });
  it("answers withheld or junk caller IDs — real people hide their number too", () => {
    for (const from of [null, undefined, "", "anonymous", "266696687", "+1"]) {
      expect(screenInboundCaller(from, ["4155550134"], [spam, spam, spam]).reject).toBe(false);
    }
  });
  it("two spam calls: still answered (that's where we only suggest blocking)", () => {
    expect(screenInboundCaller("+14155550199", [], [spam, spam]).reject).toBe(false);
  });
  it(`${AUTO_REJECT_SPAM_CALLS} spam calls in the window: turned away`, () => {
    expect(AUTO_REJECT_SPAM_CALLS).toBe(3);
    expect(screenInboundCaller("+14155550199", [], [spam, spam, spam])).toEqual({ reject: true, reason: "repeat_spam" });
  });
  it("one real outcome clears the number, however much spam it also sent", () => {
    for (const real of [
      { outcome: "booked", hasContact: false },
      { outcome: "lead", hasContact: false },
      { outcome: "escalated", hasContact: false },
      { outcome: "faq_answered", hasContact: true },
    ]) {
      expect(screenInboundCaller("+14155550199", [], [spam, spam, spam, spam, real]).reject).toBe(false);
    }
  });
  it("ordinary calls don't add up to spam", () => {
    const plain = { outcome: "faq_answered", hasContact: false };
    expect(screenInboundCaller("+14155550199", [], [plain, plain, plain, plain]).reject).toBe(false);
    expect(screenInboundCaller("+14155550199", [], [plain, spam, spam]).reject).toBe(false);
  });
});

describe("isSilentOrShort", () => {
  it(`calls of ${SILENT_CALL_MAX_SEC}s or less count`, () => {
    expect(isSilentOrShort({ durationSec: 10, transcript: "Agent: Hi\nUser: Hello" })).toBe(true);
    expect(isSilentOrShort({ durationSec: 11, transcript: "Agent: Hi\nUser: Hello" })).toBe(false);
  });
  it("a longer call where the caller never spoke counts", () => {
    expect(isSilentOrShort({ durationSec: 25, transcript: "Agent: Thanks for calling.\nAgent: Are you still there?" })).toBe(true);
    expect(isSilentOrShort({ durationSec: 25, transcript: "" })).toBe(true);
  });
  it("unknown duration or a missing transcript isn't taken as silence", () => {
    expect(isSilentOrShort({ durationSec: null, transcript: "" })).toBe(false);
    expect(isSilentOrShort({ durationSec: 40, transcript: null })).toBe(false);
  });
});

describe("silentRepeatCandidates — suggest, never block", () => {
  const silent = (n: string, day: number) => ({
    fromNumber: n,
    durationSec: 4,
    transcript: "Agent: Thanks for calling.",
    hasContact: false,
    startAt: new Date(Date.UTC(2026, 10, day)),
  });
  it(`suggests a number after ${SILENT_REPEAT_MIN_CALLS} silent calls, not before`, () => {
    expect(SILENT_REPEAT_MIN_CALLS).toBe(3);
    expect(silentRepeatCandidates([silent("+14155550111", 1), silent("+14155550111", 2)], [])).toEqual([]);
    const s = silentRepeatCandidates([silent("+14155550111", 1), silent("+14155550111", 2), silent("+14155550111", 3)], []);
    expect(s).toEqual([{ phone: "4155550111", calls: 3, lastAt: new Date(Date.UTC(2026, 10, 3)) }]);
  });
  it("one real conversation from that number and it's never suggested", () => {
    const real = { ...silent("+14155550111", 4), durationSec: 90, transcript: "Agent: Hi\nUser: I need a quote" };
    expect(silentRepeatCandidates([silent("+14155550111", 1), silent("+14155550111", 2), silent("+14155550111", 3), real], [])).toEqual([]);
    const lead = { ...silent("+14155550111", 4), hasContact: true };
    expect(silentRepeatCandidates([silent("+14155550111", 1), silent("+14155550111", 2), silent("+14155550111", 3), lead], [])).toEqual([]);
  });
  it("skips numbers already blocked and caller IDs we can't read", () => {
    const rows = [1, 2, 3].map((d) => silent("+14155550111", d));
    expect(silentRepeatCandidates(rows, ["4155550111"])).toEqual([]);
    expect(silentRepeatCandidates([1, 2, 3].map((d) => silent("anonymous", d)), [])).toEqual([]);
  });
});

describe("the owner's 'let through' list", () => {
  const spam = { outcome: "spam", hasContact: false };
  it("overrides the automatic rule", () => {
    expect(screenInboundCaller("+14155550199", [], [spam, spam, spam], ["4155550199"]).reject).toBe(false);
  });
  it("never overrides the owner's own block", () => {
    expect(screenInboundCaller("+14155550199", ["4155550199"], [], ["4155550199"])).toEqual({ reject: true, reason: "blocked" });
  });
});

describe("autoRejectedNumbers — what the owner sees as turned away", () => {
  const row = (fromNumber: string, outcome: string, hasContact = false, day = 1) => ({
    fromNumber,
    outcome,
    hasContact,
    startAt: new Date(Date.UTC(2026, 10, day)),
  });
  it("lists exactly the numbers the screen would reject for repeat spam", () => {
    const calls = [
      ...[1, 2, 3].map((d) => row("+14155550199", "spam", false, d)),
      ...[1, 2].map((d) => row("+14155550188", "spam", false, d)),
      ...[1, 2, 3].map((d) => row("+14155550177", "spam", false, d)),
      row("+14155550177", "booked"),
      ...[1, 2, 3].map((d) => row("+14155550166", "spam", false, d)),
      ...[1, 2, 3].map((d) => row("+14155550155", "spam", false, d)),
    ];
    expect(autoRejectedNumbers(calls, ["4155550166"], ["4155550155"])).toEqual([
      { phone: "4155550199", calls: 3, lastAt: new Date(Date.UTC(2026, 10, 3)) },
    ]);
  });
});

describe("summarizeTurnedAway", () => {
  const now = new Date("2026-11-27T20:00:00.000Z");
  const ago = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

  it("counts the window, newest first, by reason", () => {
    const s = summarizeTurnedAway(
      [
        { at: ago(40), phone: "4155550101", reason: "blocked" },
        { at: ago(1), phone: "4155550102", reason: "repeat_spam" },
        { at: ago(0.5), phone: "4155550101", reason: "blocked" },
        { at: "junk", phone: "4155550103", reason: "blocked" },
      ],
      30,
      now,
    );
    expect(s).toMatchObject({ total: 2, blocked: 1, repeatSpam: 1, capped: false });
    expect(s.recent.map((r) => r.phone)).toEqual(["4155550101", "4155550102"]);
    expect(turnedAwayLine(s)).toBe("2 calls (1 from numbers you blocked, 1 repeat spam)");
  });

  it("empty and missing logs are zero", () => {
    expect(summarizeTurnedAway(undefined, 30, now)).toMatchObject({ total: 0, recent: [] });
  });

  it("a full log whose oldest entry is still in the window is a floor", () => {
    const full = Array.from({ length: MAX_TURNED_AWAY }, (_, i) => ({
      at: ago(i / 100),
      phone: "4155550101",
      reason: "blocked" as const,
    }));
    const s = summarizeTurnedAway(full, 30, now);
    expect(s.capped).toBe(true);
    expect(turnedAwayLine({ ...s, recent: [] })).toBe("100+ calls (100 from numbers you blocked)");
    expect(summarizeTurnedAway(full, 0.5, now).capped).toBe(false);
    expect(turnedAwayLine(summarizeTurnedAway(full.slice(0, 1), 30, now))).toBe(
      "1 call (1 from numbers you blocked)",
    );
  });
});
