import { describe, expect, it } from "vitest";
import { agentConversationSettings, CONVERSATION_SETTINGS, END_CALL_AFTER_SILENCE_MS, SILENCE_REMINDER_MS } from "./retell";

describe("agentConversationSettings", () => {
  it("sets low-latency, natural turn-taking defaults", () => {
    const s = agentConversationSettings("America/New_York");
    expect(s.responsiveness).toBe(1);
    expect(s.interruption_sensitivity).toBeGreaterThan(0.5);
    expect(s.interruption_sensitivity).toBeLessThan(1);
    expect(s.enable_backchannel).toBe(true);
    expect(s.denoising_mode).toBe("noise-cancellation");
    expect(s.max_call_duration_ms).toBe(20 * 60_000);
    expect(s.timezone).toBe("America/New_York");
  });
  it("omits an invalid or empty timezone instead of sending it to Retell", () => {
    expect(agentConversationSettings("Not/AZone")).toEqual(CONVERSATION_SETTINGS);
    expect(agentConversationSettings("")).toEqual(CONVERSATION_SETTINGS);
    expect(agentConversationSettings(null)).toEqual(CONVERSATION_SETTINGS);
  });
});

describe("dead-air settings", () => {
  it("end a silent call after 20s, with one reminder at 10s, on every sync", () => {
    const s = agentConversationSettings("America/New_York");
    expect(s.end_call_after_silence_ms).toBe(20_000);
    expect(s.reminder_trigger_ms).toBe(10_000);
    expect(s.reminder_max_count).toBe(1);
    expect(END_CALL_AFTER_SILENCE_MS).toBeGreaterThanOrEqual(10_000); // Retell's floor
    expect(SILENCE_REMINDER_MS).toBeLessThan(END_CALL_AFTER_SILENCE_MS);
  });
});
