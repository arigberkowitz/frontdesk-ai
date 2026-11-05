import { describe, expect, it } from "vitest";
import { forwardingCodes } from "./forwarding-codes";

describe("forwardingCodes", () => {
  it("all-calls mode uses *72 with the AT&T/T-Mobile code", () => {
    const f = forwardingCodes("all_calls", "+13055550142");
    expect(f.turnOn).toContain("*72 (305) 555-0142");
    expect(f.turnOn).toContain("**21*+13055550142#");
    expect(f.turnOff).toContain("*73");
  });
  it("missed-only (Missed-Call Rescue) never tells them to dial *72", () => {
    const f = forwardingCodes("missed_only", "+13055550142");
    for (const s of [f.turnOn, f.turnOnHtml, f.turnOff, f.short]) expect(s).not.toContain("*72");
    expect(f.turnOn).toContain("*92 (305) 555-0142");
    expect(f.turnOn).toContain("**61*+13055550142#");
    expect(f.turnOnHtml).toContain("AT&amp;T");
  });
});
