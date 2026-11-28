import { describe, expect, it } from "vitest";
import { agentBindings, outboundAgent, placeCallErrorMessage } from "./retell-outbound";

describe("agentBindings / outboundAgent", () => {
  it("binds one agent both ways at weight 1", () => {
    expect(agentBindings("agent_1")).toEqual({
      inbound_agents: [{ agent_id: "agent_1", weight: 1 }],
      outbound_agents: [{ agent_id: "agent_1", weight: 1 }],
    });
  });
  it("passes the agent per call", () => {
    expect(outboundAgent("agent_1")).toEqual({ override_agent_id: "agent_1" });
  });
});

describe("placeCallErrorMessage", () => {
  it("explains the prod error without blaming the owner's number", () => {
    const m = placeCallErrorMessage(new Error("400 No outbound agent id set up for phone number."));
    expect(m).toMatch(/isn't set up for outgoing calls/);
    expect(m).not.toMatch(/may not be able to dial out/);
  });
  it("recognises billing, rate limits, bad destination and missing number", () => {
    expect(placeCallErrorMessage(new Error("402 Payment required"))).toMatch(/billing/);
    expect(placeCallErrorMessage(new Error("429 Too many concurrent calls"))).toMatch(/at once/);
    expect(placeCallErrorMessage(new Error("400 to_number is invalid"))).toMatch(/full US number/);
    expect(placeCallErrorMessage(new Error("404 from_number not found"))).toMatch(/isn't active/);
  });
  it("shows the provider's own words for anything else, with credentials stripped", () => {
    const m = placeCallErrorMessage(
      new Error("500 weird failure key_abcdef1234567890 and 0123456789abcdef0123456789abcdef0123"),
    );
    expect(m).toMatch(/Our phone provider said: 500 weird failure/);
    expect(m).not.toMatch(/abcdef1234567890/);
    expect(m).not.toMatch(/0123456789abcdef0123456789abcdef/);
    expect(m.length).toBeLessThan(260);
  });
  it("copes with non-errors", () => {
    expect(placeCallErrorMessage(undefined)).toBe("Couldn't place the call.");
  });
});
