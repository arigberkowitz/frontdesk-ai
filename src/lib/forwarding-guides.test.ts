import { describe, expect, it } from "vitest";
import { FORWARDING_GUIDES, fillGuideText, findGuide, guideFor } from "./forwarding-guides";

describe("forwarding guides", () => {
  it("covers every service Ari asked for", () => {
    expect(FORWARDING_GUIDES.map((g) => g.label)).toEqual(
      expect.arrayContaining([
        "AT&T (mobile)",
        "T-Mobile (mobile)",
        "Verizon (mobile)",
        "RingCentral",
        "Comcast Business VoiceEdge",
        "Spectrum Business Voice",
        "Google Voice",
        "Grasshopper",
        "Vonage Business",
        "8x8",
        "Ooma",
        "Nextiva",
        "Dialpad",
        "Other / not sure",
      ]),
    );
  });

  it("every guide has steps for both modes and an official source link", () => {
    for (const g of FORWARDING_GUIDES) {
      expect(g.always.steps.length, g.id).toBeGreaterThan(0);
      expect(g.missed.steps.length, g.id).toBeGreaterThan(0);
      expect(g.sources.length, g.id).toBeGreaterThan(0);
      for (const s of g.sources) expect(s.url, g.id).toMatch(/^https?:\/\//);
    }
  });

  it("fills the AI number everywhere and leaves no placeholder behind", () => {
    for (const g of FORWARDING_GUIDES) {
      for (const mode of ["all_calls", "missed_only"] as const) {
        const v = guideFor(g, mode, "+12272382281");
        const all = [...v.steps, v.checkWithProvider ?? ""].join("\n");
        expect(all, `${g.id} ${mode}`).not.toMatch(/\{(num|dial|e164|gsm)\}/);
      }
    }
  });

  it("uses the plan's mode: missed-call guides never tell you to forward every call, and vice versa", () => {
    const att = guideFor(findGuide("att")!, "missed_only", "+12272382281");
    expect(att.steps.join(" ")).toContain("**61*2272382281#");
    expect(att.steps.join(" ")).not.toContain("**21*");
    const tm = guideFor(findGuide("tmobile")!, "all_calls", "+12272382281");
    expect(tm.steps.join(" ")).toContain("**21*12272382281#");
    expect(guideFor(findGuide("verizon")!, "missed_only", "+12272382281").steps[0]).toContain("*71 followed by 2272382281");
    expect(guideFor(findGuide("verizon")!, "all_calls", "+12272382281").steps[0]).toContain("*72 followed by 2272382281");
  });

  it("says 'check with your provider' where the vendor's docs are thin or it can't work", () => {
    for (const id of ["googlevoice", "spectrum", "ooma", "vonage", "ringcentral", "att"]) {
      const g = findGuide(id)!;
      const text = [g.always.checkWithProvider, g.missed.checkWithProvider].join(" ");
      expect(text.length, id).toBeGreaterThan(20);
    }
    const gv = guideFor(findGuide("googlevoice")!, "all_calls", "+12272382281");
    expect(gv.steps.join(" ")).toMatch(/unsupported/);
  });

  it("formats the number placeholders", () => {
    expect(fillGuideText("{num} {dial} {e164}", "+12272382281")).toBe("(227) 238-2281 2272382281 +12272382281");
  });
});
