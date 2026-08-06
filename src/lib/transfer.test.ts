import { describe, expect, it } from "vitest";
import { buildAgentTools } from "./retell";
import { openHoursSummary } from "./prompt";
import { analyzeCall, transferDroppedImmediately } from "./call-health";
import { explainSmsError } from "./notifier";

/**
 * The transfer, from the two real calls that broke it.
 *
 * Ari called his own AI twice on the evening of Aug 5 and asked for a person.
 * The first call was merged into his mother's voicemail greeting; the second
 * reached her — she said "Hello?" — and then the line died, nineteen seconds
 * after it started. The product reported both as "FAQ answered", and the AI
 * summary of the second one read "successfully handed off without any issues."
 *
 * Everything below is anchored to those two transcripts.
 */

const t = (...lines: string[]) => lines.join("\n");

/** Call 1 — the transfer landed in voicemail and the caller was left there. */
const VOICEMAIL_CALL = t(
  "Agent: Hi, thanks for calling Lawyers for justice!",
  "User: Agent.",
  "Agent: Connecting you to a teammate now.",
  "Transfer Target: Your call has been forwarded to voicemail.",
  "Transfer Target: The person you're trying to reach is not available.",
  "User: Do have",
  "Transfer Target: At",
  "User: your phone?",
  "Transfer Target: the tone,",
  "Transfer Target: please record your message.",
  "Agent: Hello, is anyone there?",
  "User: Hello, Linda. Pickup.",
);

/** Call 2 — a human answered and the bridge died on the word "Hello?". */
const DROPPED_CALL = t(
  "Agent: Hi, thanks for calling Lawyers for justice! This is Riley,",
  "User: Agent.",
  "Agent: Connecting you to a teammate now.",
  "Transfer Target: Hello?",
);

describe("a transfer that connects and immediately dies", () => {
  it("is caught on the real call that looked successful", () => {
    expect(transferDroppedImmediately(DROPPED_CALL, 19)).toBe(true);
    const r = analyzeCall({ transcript: DROPPED_CALL, durationSec: 19, outcome: "escalated" });
    expect(r.problems).toContain("transfer_dropped");
    expect(r.notes.join(" ")).toContain("may not have connected");
  });

  // The whole point of the flag: "escalated" meant we tried, and the summary
  // called it a clean handoff. The caller spoke to nobody.
  it("stops the caller being counted as having reached a person", () => {
    const r = analyzeCall({ transcript: DROPPED_CALL, durationSec: 19, outcome: "escalated" });
    expect(r.problems).toContain("stranded_asking_for_human");
    expect(r.clean).toBe(false);
  });

  // The word people actually say to a phone system. It was missing from the
  // "caller asked for a person" list entirely, so the two calls this whole
  // fix came from were both reported as clean.
  it('hears "agent" as a request for a person', () => {
    const r = analyzeCall({ transcript: DROPPED_CALL, durationSec: 19 });
    expect(r.problems).toContain("asked_for_human");
  });

  it("leaves a transfer that turned into a real conversation alone", () => {
    const good = t(
      "User: Can I speak to someone?",
      "Agent: One moment.",
      "Transfer Target: Hi, this is Dana, how can I help?",
    );
    expect(transferDroppedImmediately(good, 240)).toBe(false);
  });

  it("doesn't double-report a voicemail as a dropped transfer", () => {
    // Voicemail is the more specific finding and has its own note; reporting
    // both would tell the owner two things went wrong when one did.
    expect(transferDroppedImmediately(VOICEMAIL_CALL, 45)).toBe(false);
    const r = analyzeCall({ transcript: VOICEMAIL_CALL, durationSec: 45 });
    expect(r.problems).toContain("transferred_to_voicemail");
    expect(r.problems).not.toContain("transfer_dropped");
  });

  it("says nothing at all about a call with no transfer in it", () => {
    expect(transferDroppedImmediately("Agent: Hi!\nUser: Bye.", 8)).toBe(false);
  });

  it("stays quiet rather than guessing when the duration is unknown", () => {
    expect(transferDroppedImmediately(DROPPED_CALL, null)).toBe(false);
  });
});

describe("the transfer tool we publish to Retell", () => {
  const transferTool = (mode: "always" | "open_hours" | "never", hours?: string) =>
    buildAgentTools("https://app.test", "client-1", "+14088329827", mode, hours).find(
      (tool) => tool.name === "transfer_to_human",
    )!;

  // Warm transfer is why Ari's calls failed: the bridge step drops even when a
  // human answers, and a voicemail classification can leave the agent silent.
  it("uses a cold transfer, not the warm one that dropped the call", () => {
    const tool = transferTool("always") as Record<string, unknown>;
    expect(tool.type).toBe("transfer_call");
    expect(tool.transfer_option).toMatchObject({
      type: "cold_transfer",
      cold_transfer_mode: "sip_invite",
    });
  });

  // Mobile voicemail answers at roughly 25-30s, and voicemail answering is
  // indistinguishable from a person answering. Giving up first is the only way
  // the caller gets handed back to the AI instead of to an answering machine.
  it("gives up ringing before a voicemail box can pick up", () => {
    const tool = transferTool("always") as Record<string, unknown>;
    const { transfer_ring_duration_ms: ms } = tool.transfer_option as {
      transfer_ring_duration_ms: number;
    };
    expect(ms).toBeGreaterThan(10_000);
    expect(ms).toBeLessThan(25_000);
  });

  // The bug: "only while you're open" used to publish a custom function tool,
  // and a custom function cannot move a call. The agent said "one moment while
  // I connect you" and then nothing happened for the rest of the call.
  it('can actually transfer in "only while you\'re open" mode', () => {
    const tool = transferTool("open_hours", "Mon–Fri 09:00–17:00") as Record<string, unknown>;
    expect(tool.type).toBe("transfer_call");
    expect(String(tool.description)).toContain("Mon–Fri 09:00–17:00");
    expect(String(tool.description)).toMatch(/only use this during/i);
  });

  it("attaches nothing that can dial anyone when the owner said never", () => {
    const tool = transferTool("never") as Record<string, unknown>;
    expect(tool.type).toBe("custom");
    expect(tool.transfer_destination).toBeUndefined();
  });

  it("falls back to taking a message when there's no number to ring", () => {
    const tool = buildAgentTools("https://app.test", "client-1", null, "always").find(
      (x) => x.name === "transfer_to_human",
    )! as Record<string, unknown>;
    expect(tool.type).toBe("custom");
  });
});

describe("opening hours in one line", () => {
  const day = (dayOfWeek: number, openTime: string | null, closeTime: string | null) => ({
    dayOfWeek,
    isClosed: !openTime,
    openTime,
    closeTime,
  });

  it("collapses a normal working week", () => {
    const week = [1, 2, 3, 4, 5].map((d) => day(d, "09:00", "17:00"));
    expect(openHoursSummary(week)).toBe("Mon–Fri 09:00–17:00");
  });

  it("keeps a different Saturday separate", () => {
    const week = [...[1, 2, 3, 4, 5].map((d) => day(d, "09:00", "17:00")), day(6, "10:00", "14:00")];
    expect(openHoursSummary(week)).toBe("Mon–Fri 09:00–17:00, Sat 10:00–14:00");
  });

  // The failure that would matter: telling a caller the business is open on a
  // day it is closed, because two non-adjacent days got merged into a range.
  it("never bridges a closed day into a range", () => {
    const week = [day(1, "09:00", "17:00"), day(3, "09:00", "17:00")];
    expect(openHoursSummary(week)).toBe("Mon 09:00–17:00, Wed 09:00–17:00");
  });

  it("says nothing when no hours are set", () => {
    expect(openHoursSummary([])).toBe("");
    expect(openHoursSummary([day(1, null, null)])).toBe("");
  });
});

describe("what we tell someone when a text fails", () => {
  // The real one. Production's credentials were rejected for days and all the
  // owner ever saw was "please try again", which fixes nothing.
  it("does not tell them to try again when the credentials are rejected", () => {
    const msg = explainSmsError(20003, "Couldn't send the follow-up — please try again.");
    expect(msg).not.toMatch(/try again/i);
    expect(msg).toMatch(/credential/i);
  });

  it("says plainly when the customer opted out", () => {
    expect(explainSmsError(21610, "fallback")).toMatch(/STOP/);
  });

  it("keeps the generic wording for codes it doesn't know", () => {
    expect(explainSmsError(99999, "fallback")).toBe("fallback");
    expect(explainSmsError(undefined, "fallback")).toBe("fallback");
  });
});
