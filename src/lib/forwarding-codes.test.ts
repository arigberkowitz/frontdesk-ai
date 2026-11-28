import { describe, expect, it } from "vitest";
import { forwardingCodes, forwardingVariants } from "./forwarding-codes";

describe("forwardingCodes", () => {
  it("all-calls mode shows *72 with AT&T and T-Mobile codes beside it, number filled in", () => {
    const f = forwardingCodes("all_calls", "+13055550142");
    expect(f.turnOn).toContain("*72 (305) 555-0142");
    expect(f.turnOn).toContain("AT&T: **21*3055550142#");
    expect(f.turnOn).toContain("T-Mobile: **21*13055550142#");
    expect(f.turnOff).toContain("*73");
    expect(f.turnOff).toContain("##21#");
    expect(f.short).toContain("**21*3055550142#");
  });
  it("missed-only (Missed-Call Rescue) never tells them to dial *72", () => {
    const f = forwardingCodes("missed_only", "+13055550142");
    for (const s of [f.turnOn, f.turnOnHtml, f.turnOff, f.short]) expect(s).not.toContain("*72");
    expect(f.turnOn).toContain("*92 (305) 555-0142");
    expect(f.turnOn).toContain("*71 (305) 555-0142");
    expect(f.turnOn).toContain("AT&T: **67*3055550142# and **61*3055550142#");
    expect(f.turnOn).toContain("T-Mobile: **67*13055550142# and **61*13055550142#");
    expect(f.turnOff).toContain("##61#");
    expect(f.turnOnHtml).toContain("AT&amp;T");
  });
});

describe("forwardingVariants", () => {
  const by = (mode: string, id: string) => forwardingVariants(mode, "+12272382281").find((v) => v.id === id)!;
  it("every-call: *72/*73, AT&T and T-Mobile are all shown, with the AI number filled in", () => {
    expect(forwardingVariants("all_calls", "(227) 238-2281").map((v) => v.id)).toEqual(["star", "att", "tmobile"]);
    expect(by("all_calls", "star").on[0]).toMatchObject({ seq: "*72" + "2272382281", show: "*72 (227) 238-2281" });
    expect(by("all_calls", "star").off[0].seq).toBe("*73");
    expect(by("all_calls", "att").on[0]).toMatchObject({ seq: "**21*2272382281#", show: "**21*2272382281#" });
    expect(by("all_calls", "tmobile").on[0].seq).toBe("**21*12272382281#");
    expect(by("all_calls", "att").off[0].seq).toBe("##21#");
    expect(by("all_calls", "tmobile").off[0].seq).toBe("##21#");
  });
  it("missed-only: busy and no-answer equivalents for every phone type", () => {
    expect(by("missed_only", "landline").on.map((o) => o.seq)).toEqual(["*902272382281", "*922272382281"]);
    expect(by("missed_only", "verizon-mobile").on[0].seq).toBe("*712272382281");
    expect(by("missed_only", "att").on.map((o) => o.seq)).toEqual(["**67*2272382281#", "**61*2272382281#"]);
    expect(by("missed_only", "att").off.map((o) => o.seq)).toEqual(["##67#", "##61#"]);
    expect(by("missed_only", "tmobile").on.map((o) => o.seq)).toEqual(["**67*12272382281#", "**61*12272382281#"]);
    expect(by("missed_only", "tmobile").off.map((o) => o.seq)).toEqual(["##67#", "##61#"]);
    for (const v of forwardingVariants("missed_only", "+12272382281")) {
      for (const o of [...v.on, ...v.off]) expect(o.seq).not.toContain("*72");
    }
  });
});
