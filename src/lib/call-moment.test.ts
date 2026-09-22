import { describe, expect, it } from "vitest";
import { clock, findMoments, turnsForCall } from "./call-moment";

const payload = {
  call: {
    transcript_object: [
      { role: "agent", content: "Thanks for calling Bright Smile, this is Riley.", words: [{ word: "Thanks", start: 0.4, end: 0.7 }] },
      { role: "user", content: "Hi, I need to book a cleaning.", words: [{ word: "Hi", start: 3.1, end: 3.3 }] },
      { role: "agent", content: "Sure — can I get your name?", words: [{ word: "Sure", start: 5.0, end: 5.2 }] },
      { role: "user", content: "Can I just talk to a real person?", words: [{ word: "Can", start: 8.0, end: 8.2 }] },
      { role: "agent", content: "I can help you with that here. What day works?", words: [{ word: "I", start: 10.5, end: 10.6 }] },
      { role: "user", content: "This is fucking useless.", words: [{ word: "This", start: 14.0, end: 14.2 }] },
    ],
  },
};

describe("turnsForCall", () => {
  it("prefers the vendor's timed turns", () => {
    const turns = turnsForCall({ transcript: "Agent: x\nUser: y", rawPayload: payload }, "Riley");
    expect(turns).toHaveLength(6);
    expect(turns[0]).toMatchObject({ role: "agent", speaker: "Riley", startSec: 0.4 });
    expect(turns[1]).toMatchObject({ role: "user", speaker: "Caller", startSec: 3.1 });
  });

  it("falls back to the plain transcript with no timings", () => {
    const turns = turnsForCall(
      { transcript: "Agent: Hello there.\nUser: Hi.\nTransfer Target: Front desk.", rawPayload: null },
      null,
    );
    expect(turns.map((t) => t.role)).toEqual(["agent", "user", "other"]);
    expect(turns[0].speaker).toBe("Your AI");
    expect(turns[2].speaker).toBe("Transfer Target");
    expect(turns.every((t) => t.startSec === null)).toBe(true);
  });

  it("joins wrapped continuation lines onto the previous turn", () => {
    const turns = turnsForCall({ transcript: "Agent: First part\nsecond part\nUser: ok", rawPayload: {} }, null);
    expect(turns[0].text).toBe("First part second part");
    expect(turns).toHaveLength(2);
  });

  it("returns nothing for an empty call", () => {
    expect(turnsForCall({ transcript: null, rawPayload: null })).toEqual([]);
  });
});

describe("findMoments", () => {
  const turns = turnsForCall({ transcript: null, rawPayload: payload }, "Riley");

  it("points 'asked for a person' at the AI's reply, not the request", () => {
    const [m] = findMoments(["stranded_asking_for_human"], turns);
    expect(m.turnIndex).toBe(4);
    expect(turns[m.turnIndex].text).toMatch(/I can help you/);
  });

  it("points frustration at the caller's line", () => {
    const [m] = findMoments(["caller_frustrated"], turns);
    expect(m.turnIndex).toBe(5);
  });

  it("finds the third repeat of a question", () => {
    const t = turnsForCall(
      {
        transcript: [
          "Agent: What's your name?",
          "User: Sam.",
          "Agent: Sorry, your name?",
          "User: Sam.",
          "Agent: Could I get your name again?",
          "User: SAM.",
        ].join("\n"),
        rawPayload: null,
      },
      null,
    );
    const [m] = findMoments(["repeated_question"], t);
    expect(m.turnIndex).toBe(4);
    expect(m.label).toMatch(/their name/);
  });

  it("never returns two moments for the same turn, and skips ones it can't place", () => {
    const ms = findMoments(["early_hangup", "no_contact_captured", "unreadable", "possible_emergency"], turns);
    expect(ms).toHaveLength(1);
    expect(ms[0].problem).toBe("early_hangup");
  });

  it("points a missing disclosure at the greeting", () => {
    const [m] = findMoments(["disclosure_missing"], turns);
    expect(m.turnIndex).toBe(0);
  });
});

describe("clock", () => {
  it("formats m:ss", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(83.7)).toBe("1:23");
  });
});
