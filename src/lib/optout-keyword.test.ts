import { describe, expect, it } from "vitest";
import { optOutKeyword } from "@/app/api/webhooks/twilio/route";

/**
 * Real people don't text a single tidy word. The old matcher stripped every
 * non-letter from the whole message and compared it to a list, so it only ever
 * matched a one-word text — while the carriers honoured STOP regardless. That
 * gap means our opt-out list drifts out of step with the real one, and we keep
 * "sending" to someone whose carrier is dropping every message.
 */
describe("finding the opt-out keyword", () => {
  it("catches STOP however it's punctuated or capitalised", () => {
    for (const body of ["STOP", "stop", "Stop.", "STOP!", " stop ", "Stop please", "stop texting me"]) {
      expect(optOutKeyword(body), body).toBe("stop");
    }
  });

  // The exact message Ari sent. First word wins: they stay opted out until a
  // clean START arrives, which is the safe direction to be wrong in.
  it("treats \"stop, start again\" as a stop", () => {
    expect(optOutKeyword("stop, start again")).toBe("stop");
  });

  it("still recognises the multi-word forms the carriers define", () => {
    expect(optOutKeyword("STOP ALL")).toBe("stopall");
    expect(optOutKeyword("unsubscribe")).toBe("unsubscribe");
    expect(optOutKeyword("cancel")).toBe("cancel");
  });

  it("recognises START and HELP the same way", () => {
    expect(optOutKeyword("START")).toBe("start");
    expect(optOutKeyword("start again please")).toBe("start");
    expect(optOutKeyword("Help!")).toBe("help");
  });

  it("returns the first word of an ordinary reply, which matches nothing", () => {
    // A real reply must fall through to the lead-matching path, not be
    // swallowed as a keyword.
    expect(optOutKeyword("Thanks, see you Thursday")).toBe("thanks");
    expect(optOutKeyword("can we move it to 3pm?")).toBe("can");
  });

  it("copes with an empty or emoji-only message", () => {
    expect(optOutKeyword("")).toBe("");
    expect(optOutKeyword("👍")).toBe("");
    expect(optOutKeyword("   ")).toBe("");
  });
});
