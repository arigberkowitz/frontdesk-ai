import { describe, expect, it } from "vitest";
import { agentConversationSettings, CONVERSATION_SETTINGS } from "./retell";

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
