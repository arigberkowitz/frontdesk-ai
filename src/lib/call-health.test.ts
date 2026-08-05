import { describe, expect, it } from "vitest";
import { analyzeCall, repeatedTopics, summarize, transferReachedVoicemail } from "./call-health";

/**
 * These encode the failures businesses actually cancel over, taken from real
 * reviews and forum posts. Each test is a call that today would be counted as
 * "answered" and reported as a success.
 */

const t = (...lines: string[]) => lines.join("\n");

describe("the caller asked for a person", () => {
  it("catches the plain ask and whether they got there", () => {
    const transcript = t(
      "Agent: Thanks for calling! How can I help?",
      "Caller: Can I speak to a real person please",
      "Agent: I can help with that.",
    );
    const stranded = analyzeCall({ transcript, durationSec: 40, hasContact: true });
    expect(stranded.problems).toContain("asked_for_human");
    expect(stranded.problems).toContain("stranded_asking_for_human");
    expect(stranded.notes.join(" ")).toContain("ended without reaching one");

    const transferred = analyzeCall({
      transcript,
      durationSec: 40,
      hasContact: true,
      transferConnected: true,
    });
    expect(transferred.problems).toContain("asked_for_human");
    expect(transferred.problems).not.toContain("stranded_asking_for_human");
  });

  it("recognizes the many ways people ask", () => {
    const phrasings = [
      "I want to talk to someone",
      "get me a human",
      "representative",
      "can I speak with a manager",
      "is this a robot",
      "are you an AI",
      "let me talk to a real human",
      "operator",
    ];
    for (const p of phrasings) {
      const r = analyzeCall({ transcript: `Caller: ${p}`, durationSec: 30, hasContact: true });
      expect(r.problems, p).toContain("asked_for_human");
    }
  });

  it("does not fire when the AGENT says the word", () => {
    // "I'll connect you with a person" must not read as the caller demanding one.
    const r = analyzeCall({
      transcript: t(
        "Agent: I can connect you with a real person if you'd like.",
        "Caller: No thanks, you're doing fine.",
      ),
      durationSec: 60,
      hasContact: true,
    });
    expect(r.problems).not.toContain("asked_for_human");
  });
});

describe("the agent asked the same thing over and over", () => {
  // The failure that got a plumber fired over a five-figure remodel: the agent
  // could not capture an address and kept asking.
  it("counts re-asks for the same field, however it's worded", () => {
    const transcript = t(
      "Agent: What's the address?",
      "Caller: 1450 Sansome Street",
      "Agent: Sorry, could I get your address again?",
      "Caller: One four five zero Sansome",
      "Agent: I didn't catch that — what is the street address?",
      "Caller: forget it",
    );
    expect(repeatedTopics(transcript)).toContain("address");
    const r = analyzeCall({ transcript, durationSec: 55, hasContact: false });
    expect(r.problems).toContain("repeated_question");
    expect(r.notes.join(" ")).toContain("their address");
  });

  it("tolerates asking twice — that's a stumble, not a pattern", () => {
    const transcript = t(
      "Agent: Can I get your name?",
      "Caller: Ari",
      "Agent: Sorry, your name again?",
      "Caller: Ari",
    );
    expect(repeatedTopics(transcript)).toHaveLength(0);
  });

  it("doesn't count a statement as a question", () => {
    const transcript = t(
      "Agent: I have your address as 1450 Sansome Street.",
      "Agent: Your address is on file.",
      "Agent: Great, the address is confirmed.",
    );
    expect(repeatedTopics(transcript)).toHaveLength(0);
  });

  it("keeps separate fields separate", () => {
    const transcript = t(
      "Agent: What's your name?",
      "Agent: What's your phone number?",
      "Agent: And the address?",
    );
    expect(repeatedTopics(transcript)).toHaveLength(0);
  });
});

describe("calls that ended badly and get counted as answered", () => {
  it("flags a hang-up in the first few seconds", () => {
    const r = analyzeCall({
      transcript: "Agent: Thanks for calling Bright Smile Dental, this is...",
      durationSec: 6,
      hasContact: false,
    });
    expect(r.problems).toContain("early_hangup");
    expect(r.notes.join(" ")).toContain("6 seconds");
  });

  it("does not count a short spam call as a lost customer", () => {
    const r = analyzeCall({ transcript: "", durationSec: 4, outcome: "spam", hasContact: false });
    expect(r.problems).not.toContain("early_hangup");
    expect(r.problems).not.toContain("no_contact_captured");
  });

  it("flags a real conversation that captured no way to call back", () => {
    const r = analyzeCall({
      transcript: t("Caller: I need a quote for a new roof", "Agent: I can help with that."),
      durationSec: 90,
      hasContact: false,
      outcome: "other",
    });
    expect(r.problems).toContain("no_contact_captured");
  });

  it("doesn't demand contact details from someone who just asked the hours", () => {
    const r = analyzeCall({
      transcript: "Caller: what time do you close",
      durationSec: 25,
      hasContact: false,
      outcome: "faq_answered",
    });
    expect(r.problems).not.toContain("no_contact_captured");
  });
});

describe("signals worth a human's eyes", () => {
  it("notices swearing", () => {
    const r = analyzeCall({
      transcript: "Caller: this is bullshit, just let me talk to someone",
      durationSec: 45,
      hasContact: true,
    });
    expect(r.problems).toContain("caller_frustrated");
  });

  it("notices possible emergencies across trades and clinics", () => {
    const cases = [
      "there's no heat and I have a newborn",
      "I smell gas",
      "the basement is flooding",
      "I'm having chest pain",
      "I was just in an accident",
      "someone broke into my house",
    ];
    for (const c of cases) {
      const r = analyzeCall({ transcript: `Caller: ${c}`, durationSec: 60, hasContact: true });
      expect(r.problems, c).toContain("possible_emergency");
    }
  });

  it("calls a good call clean", () => {
    const r = analyzeCall({
      transcript: t(
        "Agent: Thanks for calling! How can I help?",
        "Caller: I'd like to book a cleaning",
        "Agent: What's your name?",
        "Caller: Dana Reed",
        "Agent: And the best number?",
        "Caller: 415 555 0134",
        "Agent: Booked for Thursday at 2. See you then!",
      ),
      durationSec: 95,
      hasContact: true,
      outcome: "booked",
    });
    expect(r.clean).toBe(true);
    expect(r.problems).toHaveLength(0);
  });

  it("survives a missing transcript instead of throwing mid-report", () => {
    expect(analyzeCall({}).clean).toBe(true);
    expect(analyzeCall({ transcript: null, durationSec: null }).clean).toBe(true);
  });
});

describe("summarize", () => {
  it("counts each problem across a period", () => {
    const calls = [
      analyzeCall({ transcript: "Caller: get me a human", durationSec: 30, hasContact: true }),
      analyzeCall({ transcript: "Agent: hi", durationSec: 5, hasContact: false }),
      analyzeCall({ transcript: "Caller: book me in", durationSec: 90, hasContact: true, outcome: "booked" }),
    ];
    const s = summarize(calls);
    expect(s.total).toBe(3);
    expect(s.clean).toBe(1);
    expect(s.askedForHuman).toBe(1);
    expect(s.strandedAskingForHuman).toBe(1);
    expect(s.earlyHangup).toBe(1);
  });
});

/**
 * The failure mode that would quietly destroy the point of this feature: a
 * transcript we can't parse produces no problems, which reads as a clean call.
 * A product whose claim is honest reporting must never manufacture good news.
 */
describe("transcripts we can't read", () => {
  it("says so instead of reporting a clean call", () => {
    // Real words, no speaker labels we recognize — e.g. the vendor changed format.
    const r = analyzeCall({
      transcript: "Hi thanks for calling. I need to book something. Sure, what day?",
      durationSec: 120,
      hasContact: true,
    });
    expect(r.readable).toBe(false);
    expect(r.clean).toBe(false);
    expect(r.problems).toContain("unreadable");
  });

  it("still catches a hang-up, because duration doesn't need parsing", () => {
    const r = analyzeCall({ transcript: "unlabelled words here", durationSec: 4 });
    expect(r.problems).toContain("early_hangup");
    expect(r.problems).toContain("unreadable");
  });

  it("an empty transcript is not the same as an unreadable one", () => {
    // Nothing was said — a ring-out or a silent call. We read it fine.
    const r = analyzeCall({ transcript: "", durationSec: 40, hasContact: true });
    expect(r.readable).toBe(true);
  });

  it("counts unreadable calls separately in the summary", () => {
    const s = summarize([
      analyzeCall({ transcript: "no labels at all", durationSec: 60, hasContact: true }),
      analyzeCall({ transcript: "Caller: book me in", durationSec: 60, hasContact: true }),
    ]);
    expect(s.unreadable).toBe(1);
    expect(s.clean).toBe(1);
  });
});

/**
 * Disclosure is the cheapest legal insurance here, and the business — not us —
 * is the one a caller's lawyer names first. So it isn't enough to configure a
 * disclosure line: we check it was actually said, on every call.
 */
describe("did the agent actually disclose", () => {
  const long = (agentLine: string) =>
    analyzeCall({
      transcript: t(`Agent: ${agentLine}`, "Caller: Sure, I'd like to book something."),
      durationSec: 90,
      hasContact: true,
      expectsDisclosure: true,
    });

  it("passes when both claims were made, however phrased", () => {
    for (const line of [
      "Hi, I'm an AI assistant for the firm and this call may be recorded.",
      "Just so you know, you're speaking with a virtual assistant, and calls are recorded for quality.",
      "This is an automated assistant — the call is being transcribed.",
    ]) {
      expect(long(line).problems, line).not.toContain("disclosure_missing");
    }
  });

  it("catches the half-disclosure — AI mentioned, recording not", () => {
    const r = long("Hi, I'm the AI assistant for Bright Smile Dental. How can I help?");
    expect(r.problems).toContain("disclosure_missing");
    expect(r.notes.join(" ")).toContain("never mentioned that the call may be recorded");
  });

  it("catches the other half — recording mentioned, AI not", () => {
    const r = long("Thanks for calling. This call may be recorded for quality purposes.");
    expect(r.problems).toContain("disclosure_missing");
    expect(r.notes.join(" ")).toContain("never said it was an AI");
  });

  it("catches neither being said at all", () => {
    const r = long("Thanks for calling Bright Smile Dental! How can I help you today?");
    expect(r.problems).toContain("disclosure_missing");
    expect(r.notes.join(" ")).toContain("didn't say it was an AI or mention recording");
  });

  it("says nothing when the business hasn't turned disclosure on", () => {
    const r = analyzeCall({
      transcript: t("Agent: Thanks for calling!", "Caller: hi"),
      durationSec: 90,
      hasContact: true,
    });
    expect(r.problems).not.toContain("disclosure_missing");
  });

  it("doesn't pile a second flag onto a four-second hang-up", () => {
    // Nobody could have disclosed anything. One flag is enough, and two would
    // train the owner to ignore both.
    const r = analyzeCall({
      transcript: "Agent: Thanks for call—",
      durationSec: 3,
      expectsDisclosure: true,
    });
    expect(r.problems).toContain("early_hangup");
    expect(r.problems).not.toContain("disclosure_missing");
  });

  it("doesn't claim a disclosure failure on a transcript it couldn't read", () => {
    const r = analyzeCall({
      transcript: "words with no speaker labels at all",
      durationSec: 90,
      expectsDisclosure: true,
    });
    expect(r.problems).toContain("unreadable");
    expect(r.problems).not.toContain("disclosure_missing");
  });
});

/**
 * The first real call through the product, verbatim from the call log.
 *
 * It taught us two things no invented test would have. Retell uses a third
 * speaker label — `Transfer Target:` — for whoever the call is handed to. And a
 * transfer can "succeed" straight into a voicemail box, which the call record
 * cannot distinguish from reaching a person.
 */
describe("the first real call", () => {
  const REAL = t(
    "Agent: Hi,",
    "User: Hi.",
    "Agent: thanks for calling Lawyers for justice! This is Riley, the AI assistant. How can I help you today?",
    "User: Let me talk to a real person.",
    "Agent: Connecting you to a team member now.",
    "Transfer Target: Your call has been forwarded to voice mail.",
    "Transfer Target: The person you're trying to reach is not available.",
    "Transfer Target: At the tone,",
    "Transfer Target: please record your message.",
    "Transfer Target: When you have finished",
    "Agent: Hello, is anyone there?",
    "Transfer Target: recording",
    "Agent: Sorry, they're not free right now. I can take your name and number and have someone call you right back, or I can keep helping you myself. What would you prefer?",
  );

  it("reads it — Agent and User labels parse as expected", () => {
    expect(analyzeCall({ transcript: REAL, durationSec: 45 }).readable).toBe(true);
  });

  it("catches the caller asking for a person", () => {
    expect(analyzeCall({ transcript: REAL, durationSec: 45 }).problems).toContain(
      "asked_for_human",
    );
  });

  it("knows the transfer hit voicemail, not a person", () => {
    expect(transferReachedVoicemail(REAL)).toBe(true);
    const r = analyzeCall({ transcript: REAL, durationSec: 45, hasContact: false });
    expect(r.problems).toContain("transferred_to_voicemail");
  });

  // The bug this call exposed: `outcome === "escalated"` means we ATTEMPTED a
  // transfer. Trusting it would have reported this caller as successfully
  // handed to a human, when they got an answering machine and hung up.
  it("still counts the caller as stranded even when the outcome says escalated", () => {
    const r = analyzeCall({
      transcript: REAL,
      durationSec: 45,
      outcome: "escalated",
      hasContact: false,
    });
    expect(r.problems).toContain("stranded_asking_for_human");
  });

  it("notices the recording half of the disclosure was never given", () => {
    // "This is Riley, the AI assistant" covers the AI half and nothing else.
    const r = analyzeCall({ transcript: REAL, durationSec: 45, expectsDisclosure: true });
    expect(r.problems).toContain("disclosure_missing");
    expect(r.notes.join(" ")).toContain("never mentioned that the call may be recorded");
  });

  it("doesn't mistake the transfer target's words for the caller's", () => {
    // "please record your message" must not read as the caller mentioning
    // recording, and none of it should count as caller speech.
    const r = analyzeCall({ transcript: REAL, durationSec: 45, hasContact: true });
    expect(r.problems).not.toContain("caller_frustrated");
  });

  it("a transfer that actually reaches a person is not flagged", () => {
    const good = t(
      "User: Can I speak to someone?",
      "Agent: Connecting you now.",
      "Transfer Target: Hi, this is Dana, how can I help?",
    );
    expect(transferReachedVoicemail(good)).toBe(false);
    const r = analyzeCall({ transcript: good, durationSec: 60, outcome: "escalated", hasContact: true });
    expect(r.problems).not.toContain("transferred_to_voicemail");
    expect(r.problems).not.toContain("stranded_asking_for_human");
  });
});
