import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_NAME, defaultGreeting, defaultGreetingEs, hasAiDisclosure, openingLine } from "./prompt";
import {
  displayNameFromVoiceId,
  isStockAgentName,
  voiceFirstName,
  voiceIdentityHint,
  voiceIdentitySaveMessage,
  voiceIdentityUpdate,
} from "./voice-identity";

describe("voiceFirstName / displayNameFromVoiceId", () => {
  it("takes the first word of a vendor name", () => {
    expect(voiceFirstName("Marissa")).toBe("Marissa");
    expect(voiceFirstName("Marissa Stone")).toBe("Marissa");
    expect(voiceFirstName("  Allie  ")).toBe("Allie");
  });
  it("reads a name out of a Retell voice id", () => {
    expect(displayNameFromVoiceId("11labs-Marissa")).toBe("Marissa");
    expect(displayNameFromVoiceId("cartesia-Allie")).toBe("Allie");
    expect(displayNameFromVoiceId("")).toBeNull();
  });
});

describe("isStockAgentName", () => {
  it("treats empty, Riley, and the previous voice as stock", () => {
    expect(isStockAgentName(null)).toBe(true);
    expect(isStockAgentName("")).toBe(true);
    expect(isStockAgentName("Riley")).toBe(true);
    expect(isStockAgentName("riley")).toBe(true);
    expect(isStockAgentName("Marissa", "Marissa")).toBe(true);
    expect(isStockAgentName("Ava", "Marissa")).toBe(false);
    expect(isStockAgentName("Front Desk")).toBe(false);
  });
});

describe("voiceIdentityUpdate", () => {
  const biz = "Lawyers for justice";

  it("names the agent after the new voice and leaves an empty greeting empty", () => {
    const r = voiceIdentityUpdate({
      voiceName: "Allie",
      businessName: biz,
      currentAgentName: null,
      currentGreeting: null,
      previousVoiceName: "Marissa",
    });
    expect(r).toEqual({ kind: "adopted", agentName: "Allie", greeting: null, greetingUpdated: false });
    const line = openingLine({
      name: biz,
      greeting: r.kind === "adopted" ? r.greeting : null,
      agentName: r.kind === "adopted" ? r.agentName : "Riley",
      recordingDisclosureEnabled: true,
    });
    expect(line).toContain("Allie");
    expect(line).not.toContain(DEFAULT_AGENT_NAME);
    expect(hasAiDisclosure(line)).toBe(true);
    expect(line).toMatch(/recorded/i);
  });

  it("rewrites a stock English greeting that still says Riley", () => {
    const r = voiceIdentityUpdate({
      voiceName: "Marissa",
      businessName: biz,
      currentAgentName: "Riley",
      currentGreeting: defaultGreeting({ name: biz }, "Riley"),
    });
    expect(r.kind).toBe("adopted");
    if (r.kind !== "adopted") return;
    expect(r.agentName).toBe("Marissa");
    expect(r.greeting).toBe(defaultGreeting({ name: biz }, "Marissa"));
    expect(hasAiDisclosure(r.greeting ?? "")).toBe(true);
  });

  it("rewrites a stock Spanish greeting", () => {
    const r = voiceIdentityUpdate({
      voiceName: "Allie",
      businessName: biz,
      currentAgentName: "Riley",
      currentGreeting: defaultGreetingEs({ name: biz }, "Riley"),
      languages: "es",
    });
    expect(r.kind).toBe("adopted");
    if (r.kind !== "adopted") return;
    expect(r.greeting).toBe(defaultGreetingEs({ name: biz }, "Allie"));
    expect(r.greeting).toContain("inteligencia artificial");
  });

  it("swaps just the old name inside a custom greeting", () => {
    const r = voiceIdentityUpdate({
      voiceName: "Allie",
      businessName: biz,
      currentAgentName: "Riley",
      currentGreeting: "Hi, this is Riley, the AI assistant for Lawyers for justice. How can I help?",
    });
    expect(r).toMatchObject({
      kind: "adopted",
      agentName: "Allie",
      greeting: "Hi, this is Allie, the AI assistant for Lawyers for justice. How can I help?",
      greetingUpdated: true,
    });
    expect(hasAiDisclosure(r.kind === "adopted" ? r.greeting ?? "" : "")).toBe(true);
  });

  it("keeps a custom agent name and does not rewrite the greeting", () => {
    const r = voiceIdentityUpdate({
      voiceName: "Allie",
      businessName: biz,
      currentAgentName: "Ava",
      currentGreeting: "Hi, you've reached Ava at Lawyers for justice, an AI assistant.",
      previousVoiceName: "Marissa",
    });
    expect(r).toEqual({ kind: "kept", agentName: "Ava" });
  });

  it("treats the previous voice's name as stock so a second switch still follows the voice", () => {
    const r = voiceIdentityUpdate({
      voiceName: "Amy",
      businessName: biz,
      currentAgentName: "Marissa",
      currentGreeting: defaultGreeting({ name: biz }, "Marissa"),
      previousVoiceName: "Marissa",
    });
    expect(r.kind).toBe("adopted");
    if (r.kind !== "adopted") return;
    expect(r.agentName).toBe("Amy");
    expect(r.greeting).toBe(defaultGreeting({ name: biz }, "Amy"));
  });
});

describe("copy", () => {
  it("explains a rename and a kept custom name", () => {
    expect(voiceIdentitySaveMessage({ kind: "adopted", agentName: "Allie", greeting: null, greetingUpdated: false }, "Allie")).toMatch(
      /introduces themselves as Allie/,
    );
    expect(voiceIdentitySaveMessage({ kind: "kept", agentName: "Ava" }, "Allie")).toMatch(/name stays Ava/);
  });
  it("hints before save", () => {
    expect(
      voiceIdentityHint({ dirty: true, selectedName: "Allie", currentAgentName: "Riley", previousVoiceName: "Marissa" }),
    ).toMatch(/introduce themselves as Allie/);
    expect(
      voiceIdentityHint({ dirty: true, selectedName: "Allie", currentAgentName: "Ava", previousVoiceName: "Marissa" }),
    ).toMatch(/name stays Ava/);
    expect(voiceIdentityHint({ dirty: false, selectedName: "Allie", currentAgentName: "Riley" })).toBeNull();
  });
});
