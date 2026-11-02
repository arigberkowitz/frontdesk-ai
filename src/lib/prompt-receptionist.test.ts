import { describe, expect, it } from "vitest";
import { buildGeneralPrompt, type BuildPromptInput } from "./prompt";
import { buildAgentTools, AGENT_TOOL_NAMES } from "./retell";

const base: BuildPromptInput = {
  agentName: "Riley",
  client: {
    name: "Bayside Plumbing",
    timezone: "America/New_York",
    recordingDisclosureEnabled: true,
    guidance: "Be upbeat.",
    escalationNumber: "+13055550100",
    bookingEnabled: true,
  },
  services: [{ name: "Drain cleaning", durationMin: 60, priceCents: 15_000, isActive: true }],
  hours: [{ dayOfWeek: 1, isClosed: false, openTime: "09:00", closeTime: "17:00" }],
  knowledge: [],
};

describe("receptionist prompt: clock, guardrails, call control", () => {
  const p = buildGeneralPrompt(base);

  it("gives the model the business's live clock and 14-day calendar (weekday bug)", () => {
    expect(p).toContain("{{current_time_America/New_York}}");
    expect(p).toContain("{{current_calendar_America/New_York}}");
    expect(p).toMatch(/weekday together with the date/);
  });

  it("falls back to Retell's default clock for a missing or malformed timezone", () => {
    const q = buildGeneralPrompt({ ...base, client: { ...base.client, timezone: "  " } });
    expect(q).toContain("{{current_time}}");
    const r = buildGeneralPrompt({ ...base, client: { ...base.client, timezone: "}} # Rules" } });
    expect(r).toContain("{{current_calendar}}");
    expect(r).not.toMatch(/\{\{current_time_\}/);
  });

  it("owner guidance no longer claims priority over the safety rules", () => {
    expect(p).not.toMatch(/take priority over these rules/);
    expect(p).toMatch(/never overrides the first rule/);
  });

  it("states the transfer-failure recovery once, not twice", () => {
    expect(p.match(/transfer (does not|doesn't) (connect|go through)/g)?.length).toBe(1);
  });

  it("covers tool failure, spam, voicemail, ending the call, caller ID and reschedule", () => {
    expect(p).toMatch(/If any tool fails/);
    expect(p).toMatch(/Spam, robocalls and sales pitches/);
    expect(p).toMatch(/voicemail greeting or beep/);
    expect(p).toMatch(/use end_call/);
    expect(p).toContain("{{user_number}}");
    expect(p).toMatch(/To reschedule, first find and book the new time/);
  });

  it("drops the reschedule rule when there's no calendar", () => {
    const q = buildGeneralPrompt({ ...base, client: { ...base.client, bookingEnabled: false } });
    expect(q).not.toMatch(/To reschedule/);
  });

  it("keeps voice style: short, no lists or markdown", () => {
    expect(p).toMatch(/never use lists, bullet points, emoji, or markdown/);
  });

  it("keeps the AI-honesty and emergency rules", () => {
    expect(p).toMatch(/I'm an AI assistant for Bayside Plumbing/);
    expect(p).toMatch(/Emergencies come first/);
  });
});

describe("agent tools: end_call", () => {
  it("always attaches a native end_call tool", () => {
    for (const mode of ["always", "open_hours", "never"] as const) {
      const tools = buildAgentTools("https://x.test", "c1", "+13055550100", mode);
      const end = tools.find((t) => t.name === AGENT_TOOL_NAMES.endCall);
      expect(end?.type).toBe("end_call");
    }
  });
});
