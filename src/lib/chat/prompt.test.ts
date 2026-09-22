import { describe, it, expect } from "vitest";
import { chatChannelPreamble, nowLine } from "./prompt";

describe("chatChannelPreamble", () => {
  const p = chatChannelPreamble({ businessName: "Bright Smile Dental", agentName: "Riley" });

  it("names the agent and the business, and says it's a chat", () => {
    expect(p).toContain("You are Riley");
    expect(p).toContain("Bright Smile Dental");
    expect(p).toMatch(/text chat/i);
    expect(p).toMatch(/Not a phone call/);
  });

  it("removes the phone-only behaviors", () => {
    expect(p).toMatch(/cannot transfer/i);
    expect(p).toMatch(/Don't read numbers back/);
  });

  it("carries the exact SMS consent wording the carriers approved", () => {
    expect(p).toContain("Want me to text you the confirmation and a reminder? Reply STOP anytime to opt out.");
    expect(p).toMatch(/Only pass sms_consent as true if they clearly say yes/);
  });

  it("forbids invention", () => {
    expect(p).toMatch(/Never invent an opening, a price, or a policy/);
  });
});

describe("nowLine", () => {
  it("renders in the business's timezone", () => {
    const line = nowLine("America/New_York", new Date("2026-09-22T19:30:00Z"));
    expect(line).toContain("September 22, 2026");
    expect(line).toContain("3:30");
    expect(line).toContain("America/New_York");
  });
  it("survives a bad timezone", () => {
    expect(nowLine("Not/AZone", new Date("2026-09-22T19:30:00Z"))).toContain("2026");
  });
});
