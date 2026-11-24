import { describe, expect, it } from "vitest";
import {
  channelStats,
  compareFollowUps,
  comparisonHeadline,
  MIN_SAMPLE_PER_CHANNEL,
} from "./followup-channels";

const row = (channel: string, sent: number, responded: number, booked: number) => ({ channel, sent, responded, booked });

describe("channelStats", () => {
  it("shows no rates below the minimum sample", () => {
    const s = channelStats({ sent: MIN_SAMPLE_PER_CHANNEL - 1, responded: 2, booked: 1 });
    expect(s.enough).toBe(false);
    expect(s.respondedPct).toBeNull();
    expect(s.bookedPct).toBeNull();
  });
  it("rounds rates at or above the minimum", () => {
    const s = channelStats({ sent: 6, responded: 4, booked: 1 });
    expect(s).toMatchObject({ enough: true, respondedPct: 67, bookedPct: 17 });
  });
  it("never lets responses or bookings exceed sends, and treats junk as 0", () => {
    expect(channelStats({ sent: 5, responded: 9, booked: 7 })).toMatchObject({ responded: 5, booked: 5 });
    expect(channelStats({ sent: Number.NaN, responded: -3, booked: undefined })).toMatchObject({
      sent: 0,
      responded: 0,
      booked: 0,
      enough: false,
    });
  });
});

describe("compareFollowUps", () => {
  it("is null when nothing was sent (card hides)", () => {
    expect(compareFollowUps([])).toBeNull();
    expect(compareFollowUps([row("sms", 0, 0, 0)])).toBeNull();
  });
  it("parses string counts from the driver and ignores unknown channels", () => {
    const c = compareFollowUps([
      { channel: "sms", sent: "8", responded: "4", booked: "2" },
      { channel: "email", sent: 50, responded: 50, booked: 50 },
    ])!;
    expect(c.text).toMatchObject({ sent: 8, responded: 4, booked: 2, bookedPct: 25 });
    expect(c.call.sent).toBe(0);
    expect(c.comparable).toBe(false);
    expect(c.leader).toBeNull();
  });
  it("names a leader only when both channels have enough data and the gap is >= 10 points", () => {
    expect(compareFollowUps([row("sms", 10, 6, 4), row("ai_call", 10, 5, 1)])!.leader).toBe("text");
    expect(compareFollowUps([row("sms", 10, 6, 1), row("ai_call", 10, 5, 4)])!.leader).toBe("call");
    expect(compareFollowUps([row("sms", 10, 6, 3), row("ai_call", 10, 5, 3)])!.leader).toBe("tie");
    expect(compareFollowUps([row("sms", 10, 6, 4), row("ai_call", 4, 4, 4)])!.leader).toBeNull();
  });
});

describe("comparisonHeadline", () => {
  it("says not enough data instead of a rate when a channel is short", () => {
    const c = compareFollowUps([row("sms", 12, 5, 3), row("ai_call", 2, 1, 1)])!;
    expect(comparisonHeadline(c)).toMatch(/^Not enough data yet/);
    expect(comparisonHeadline(c)).not.toMatch(/%/);
  });
  it("uses only the measured rates", () => {
    const c = compareFollowUps([row("sms", 10, 6, 4), row("ai_call", 8, 5, 1)])!;
    expect(comparisonHeadline(c)).toBe(
      "Text backs are booking more: 40% of callers booked after a text, 13% after an AI call back.",
    );
    const t = compareFollowUps([row("sms", 10, 6, 3), row("ai_call", 10, 5, 3)])!;
    expect(comparisonHeadline(t)).toMatch(/^About the same so far: 30% .* 30% /);
  });
});
