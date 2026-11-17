import { describe, expect, it } from "vitest";
import {
  cleanGapQuestions,
  matchSuggestion,
  normalizeQuestion,
  sameQuestion,
  summarizeGaps,
} from "./knowledge-gaps";
import { gapActionHref } from "@/components/portal/unanswered-questions";

describe("normalizeQuestion / sameQuestion", () => {
  it("ignores case, punctuation and apostrophes", () => {
    expect(normalizeQuestion("  Do you take Visa?? ")).toBe("do you take visa");
    expect(sameQuestion("What's your warranty?", "whats your warranty")).toBe(true);
  });
  it("groups rewordings that share the same meaningful words", () => {
    expect(sameQuestion("Do you service tankless water heaters?", "Can you service a tankless water heater?")).toBe(
      true,
    );
    expect(sameQuestion("Do you service tankless water heaters?", "Do you service tankless water heaters")).toBe(true);
    expect(sameQuestion("Is there parking?", "Do you offer financing?")).toBe(false);
  });
  it("never matches empty strings", () => {
    expect(sameQuestion("", "")).toBe(false);
    expect(sameQuestion("?", "!")).toBe(false);
  });
});

describe("cleanGapQuestions", () => {
  it("returns [] for anything that isn't a list", () => {
    expect(cleanGapQuestions(undefined)).toEqual([]);
    expect(cleanGapQuestions("Do you take Visa?")).toEqual([]);
  });
  it("trims, capitalizes, de-duplicates and caps at three", () => {
    expect(
      cleanGapQuestions([
        "  do you take visa? ",
        "Do you take Visa",
        "",
        42,
        "Is there parking?",
        "Do you offer financing?",
        "Are you open on Christmas?",
      ]),
    ).toEqual(["Do you take visa?", "Is there parking?", "Do you offer financing?"]);
  });
  it("drops anything carrying a phone number or email", () => {
    expect(
      cleanGapQuestions(["Can you call 415-555-0100 back?", "Email bob@example.com the quote?", "Is there parking?"]),
    ).toEqual(["Is there parking?"]);
  });
  it("caps length", () => {
    const [q] = cleanGapQuestions(["x".repeat(500)]);
    expect(q.length).toBe(120);
    expect(q.endsWith("…")).toBe(true);
  });
});

describe("summarizeGaps", () => {
  const rows = [
    { callId: "c1", questions: ["Do you offer financing?"] },
    { callId: "c2", questions: ["Do you offer financing", "Is there parking?"] },
    { callId: "c3", questions: [] },
    { callId: "c4", questions: ["do you offer financing?"] },
    { callId: "c5", questions: [] },
  ];

  it("counts calls, not questions, and rounds the percent", () => {
    const s = summarizeGaps(rows);
    expect(s.checked).toBe(5);
    expect(s.withGap).toBe(3);
    expect(s.percent).toBe(60);
  });

  it("groups the same question across calls, most-asked first, with the common wording", () => {
    const s = summarizeGaps(rows);
    expect(s.top.map((g) => [g.question, g.calls])).toEqual([
      ["Do you offer financing?", 3],
      ["Is there parking?", 1],
    ]);
    expect(s.top[0].callIds.sort()).toEqual(["c1", "c2", "c4"]);
  });

  it("counts a call once even if it asked the same thing twice", () => {
    const s = summarizeGaps([{ callId: "c1", questions: ["Is there parking?", "is there parking"] }]);
    expect(s.top).toHaveLength(1);
    expect(s.top[0].calls).toBe(1);
  });

  it("is honest about no data: zero checked, zero percent, nothing listed", () => {
    expect(summarizeGaps([])).toEqual({ checked: 0, withGap: 0, percent: 0, top: [] });
  });

  it("limits to the top five", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ callId: `c${i}`, questions: [`Question number ${i} about topic${i}?`] }));
    expect(summarizeGaps(many).top).toHaveLength(5);
  });

  it("marks questions the knowledge base now answers", () => {
    const s = summarizeGaps(rows, { knowledgeQuestions: ["Is there parking?"] });
    expect(s.top.find((g) => g.question === "Is there parking?")?.answered).toBe(true);
    expect(s.top.find((g) => g.question === "Do you offer financing?")?.answered).toBe(false);
  });

  it("links the matching open suggestion", () => {
    const s = summarizeGaps(rows, {
      suggestions: [
        { id: "s-park", question: "Is there parking nearby?", callIds: ["c2"] },
        { id: "s-fin", question: "Do you offer financing?", callIds: [] },
      ],
    });
    expect(s.top.find((g) => g.question === "Do you offer financing?")?.suggestionId).toBe("s-fin");
    expect(s.top.find((g) => g.question === "Is there parking?")?.suggestionId).toBe("s-park");
  });
});

describe("matchSuggestion", () => {
  it("doesn't link a suggestion just because it came from the same call", () => {
    expect(
      matchSuggestion("Is there parking?", ["c1"], [{ id: "s1", question: "What's the warranty?", callIds: ["c1"] }]),
    ).toBeNull();
  });
  it("ignores guidance-style suggestions with no question", () => {
    expect(matchSuggestion("Is there parking?", ["c1"], [{ id: "s1", question: null, callIds: ["c1"] }])).toBeNull();
  });
});

describe("gapActionHref", () => {
  it("goes to the drafted suggestion when there is one", () => {
    expect(gapActionHref({ question: "Q?", suggestionId: "abc" })).toBe("/portal#suggestion-abc");
  });
  it("otherwise opens the knowledge form with the question filled in", () => {
    expect(gapActionHref({ question: "Do you take Visa & Amex?", suggestionId: null })).toBe(
      "/portal/knowledge?add=Do%20you%20take%20Visa%20%26%20Amex%3F",
    );
  });
});
