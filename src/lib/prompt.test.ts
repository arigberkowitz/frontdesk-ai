import { describe, expect, it } from "vitest";
import {
  buildGeneralPrompt,
  defaultGreeting,
  resolveDisclosureLine,
  hasAiDisclosure,
  hasRecordingNotice,
  openingLine,
  DEFAULT_AGENT_NAME,
  type BuildPromptInput,
  type PromptClient,
} from "./prompt";

/**
 * The prompt builder is the money path: its output IS the live phone line.
 * These tests pin the behaviors a regression would silently break.
 */

const client: PromptClient = {
  name: "Bayside Plumbing",
  industry: "plumber",
  address: "123 Dock St, Miami, FL",
  timezone: "America/New_York",
  escalationNumber: "+13055550100",
  recordingDisclosureEnabled: true,
  recordingDisclosureLine: null,
  guidance: "Never quote exact prices for slab leaks.",
  bookingInstructions: null,
  humanHandoffEnabled: true,
  humanHoursNote: "weekdays 9-5",
  languages: "en-es",
  bookingEnabled: true,
};

const input: BuildPromptInput = {
  agentName: "Riley",
  client,
  services: [
    { name: "Drain cleaning", durationMin: 60, priceCents: 15_000, description: null, isActive: true },
    { name: "Old service", durationMin: 30, priceCents: 5_000, description: null, isActive: false },
  ],
  hours: [
    { dayOfWeek: 1, isClosed: false, openTime: "09:00", closeTime: "17:00" },
    { dayOfWeek: 0, isClosed: true, openTime: null, closeTime: null },
  ],
  knowledge: [
    { question: "Do you have parking?", answer: "Free lot behind the building.", isActive: true },
    { question: "Old inactive Q", answer: "Should not appear.", isActive: false },
  ],
};

describe("buildGeneralPrompt", () => {
  const prompt = buildGeneralPrompt(input);

  it("includes the business, agent name, and guidance", () => {
    expect(prompt).toContain("Bayside Plumbing");
    expect(prompt).toContain("Riley");
    expect(prompt).toContain("Never quote exact prices for slab leaks.");
  });

  it("includes only ACTIVE services with formatted price", () => {
    expect(prompt).toContain("Drain cleaning");
    expect(prompt).toContain("$150");
    expect(prompt).not.toContain("Old service");
  });

  it("includes only ACTIVE knowledge", () => {
    expect(prompt).toContain("Free lot behind the building.");
    expect(prompt).not.toContain("Should not appear.");
  });

  it("renders hours with closed days", () => {
    expect(prompt).toContain("09:00–17:00");
    expect(prompt).toMatch(/Sunday: Closed/);
  });

  it("carries the recording disclosure when enabled", () => {
    expect(prompt).toContain("may be recorded");
  });

  it("omits the disclosure when disabled", () => {
    const p = buildGeneralPrompt({
      ...input,
      client: { ...client, recordingDisclosureEnabled: false },
    });
    expect(p).not.toContain("may be recorded");
  });
});

describe("resolveDisclosureLine", () => {
  it("uses the custom line when provided", () => {
    expect(
      resolveDisclosureLine({ ...client, recordingDisclosureLine: "Custom line." }),
    ).toBe("Custom line.");
  });
  it("returns null when disclosure is off", () => {
    expect(resolveDisclosureLine({ ...client, recordingDisclosureEnabled: false })).toBeNull();
  });
});

describe("defaultGreeting", () => {
  it("names the business and the agent", () => {
    const g = defaultGreeting({ name: "Bayside Plumbing" });
    expect(g).toContain("Bayside Plumbing");
    expect(g).toContain(DEFAULT_AGENT_NAME);
  });
});

/**
 * When callers may reach a person. The wrong value here produces the worst call
 * this product can make — "one moment while I connect you", then an answering
 * machine — which is the second most common reason businesses cancel.
 */
describe("handoff mode", () => {
  const build = (handoffMode: "always" | "open_hours" | "never") =>
    buildGeneralPrompt({ ...input, client: { ...client, handoffMode } });

  it("never: forbids promising a transfer at all", () => {
    const p = build("never");
    expect(p).toContain("There is NO ONE available to transfer to");
    expect(p).toContain("take_message");
    expect(p).not.toContain("Don't wait to be asked");
  });

  it("open_hours: allows it while open, forbids it after", () => {
    const p = build("open_hours");
    expect(p).toContain("ONLY during the opening hours");
    expect(p).toContain("do not offer a transfer");
    expect(p).toContain("transfer_to_human");
  });

  it("always: keeps the original behaviour", () => {
    const p = build("always");
    expect(p).toContain("use transfer_to_human to connect them to the team");
    expect(p).not.toContain("There is NO ONE available");
  });

  it("defaults to always when nothing is set, so nothing changes silently", () => {
    expect(buildGeneralPrompt(input)).toContain(
      "use transfer_to_human to connect them to the team",
    );
  });
});

describe("opening line disclosure (can't be removed by a custom greeting)", () => {
  const base = {
    name: "Bayside Plumbing",
    recordingDisclosureEnabled: true,
    recordingDisclosureLine: null,
  };

  it("default greeting says AI and gets the recording notice", () => {
    const line = openingLine(base);
    expect(hasAiDisclosure(line)).toBe(true);
    expect(hasRecordingNotice(line)).toBe(true);
  });

  it("a custom greeting with no AI mention gets the disclosure prepended", () => {
    const line = openingLine({ ...base, greeting: "Thanks for calling Bayside, how can I help?" });
    expect(line.startsWith("Hi, you've reached the AI assistant for Bayside Plumbing, and this call may be recorded.")).toBe(true);
    expect(line).toContain("Thanks for calling Bayside, how can I help?");
  });

  it("a greeting that denies being AI still gets the disclosure", () => {
    const line = openingLine({ ...base, greeting: "Hi, I'm a real person, not an AI assistant!" });
    expect(line).toMatch(/^Hi, you've reached the AI assistant/);
  });

  it("doesn't double up when the greeting already discloses both", () => {
    const g = "Hi, you've reached Bayside's AI receptionist — this call may be recorded. How can I help?";
    expect(openingLine({ ...base, greeting: g })).toBe(g);
  });

  it("AI disclosure stays even when the recording notice is turned off", () => {
    const line = openingLine({ ...base, recordingDisclosureEnabled: false, greeting: "Bayside, how can I help?" });
    expect(hasAiDisclosure(line)).toBe(true);
    expect(hasRecordingNotice(line)).toBe(false);
  });

  it("uses the operator's custom disclosure line, and still enforces AI if it lacks it", () => {
    const line = openingLine({
      ...base,
      greeting: "Bayside, how can I help?",
      recordingDisclosureLine: "Calls are recorded for quality.",
    });
    expect(line).toBe("Hi, you've reached the AI assistant for Bayside Plumbing. Calls are recorded for quality. Bayside, how can I help?");
    expect(hasAiDisclosure(line)).toBe(true);
    expect(hasRecordingNotice(line)).toBe(true);
  });

  it("the prompt never tells the model to hide being an AI", () => {
    const p = buildGeneralPrompt({ ...input, client: { ...client, recordingDisclosureEnabled: false } });
    expect(p).toMatch(/never claim or imply you're human/);
  });
});
