import { describe, expect, it } from "vitest";
import {
  blocksForProvider,
  businessWideBlocks,
  checkSlot,
  overlapsBlock,
} from "./booking-window";

/**
 * A caller can name any time they like — "can you do Sunday at six?" — and the
 * booking tool used to check only whether another appointment was in the way.
 * These are the answers it should have been giving.
 */

const TZ = "America/Los_Angeles";
const MON_FRI = [1, 2, 3, 4, 5].map((dayOfWeek) => ({
  dayOfWeek,
  isClosed: false,
  openTime: "09:00",
  closeTime: "17:00",
}));
const CLOSED_WEEKEND = [
  ...MON_FRI,
  { dayOfWeek: 0, isClosed: true, openTime: null, closeTime: null },
  { dayOfWeek: 6, isClosed: true, openTime: null, closeTime: null },
];

/** Local wall clock → ms, for readable test setup. */
const at = (iso: string, offset: string) => Date.parse(`${iso}${offset}`);
const PDT = "-07:00";

describe("checkSlot", () => {
  it("accepts a normal weekday appointment inside opening hours", () => {
    expect(
      checkSlot({
        hours: CLOSED_WEEKEND,
        tz: TZ,
        startMs: at("2026-08-05T10:00:00", PDT), // Wednesday
        endMs: at("2026-08-05T10:30:00", PDT),
      }),
    ).toBe("ok");
  });

  it("refuses a day the business is closed", () => {
    expect(
      checkSlot({
        hours: CLOSED_WEEKEND,
        tz: TZ,
        startMs: at("2026-08-09T18:00:00", PDT), // Sunday, 6pm
        endMs: at("2026-08-09T18:30:00", PDT),
      }),
    ).toBe("closed");
  });

  it("refuses a day with no row at all, not just one marked closed", () => {
    // Only Mon–Fri configured; Saturday simply isn't in the list.
    expect(
      checkSlot({
        hours: MON_FRI,
        tz: TZ,
        startMs: at("2026-08-08T10:00:00", PDT), // Saturday
        endMs: at("2026-08-08T10:30:00", PDT),
      }),
    ).toBe("closed");
  });

  it("refuses 3 AM, which an empty calendar happily calls free", () => {
    expect(
      checkSlot({
        hours: CLOSED_WEEKEND,
        tz: TZ,
        startMs: at("2026-08-05T03:00:00", PDT),
        endMs: at("2026-08-05T03:30:00", PDT),
      }),
    ).toBe("closed");
  });

  it("requires the appointment to FIT, not merely to start before closing", () => {
    // A 60-minute service starting at 4:30 runs half an hour past the door.
    expect(
      checkSlot({
        hours: CLOSED_WEEKEND,
        tz: TZ,
        startMs: at("2026-08-05T16:30:00", PDT),
        endMs: at("2026-08-05T17:30:00", PDT),
      }),
    ).toBe("closed");
    // Ending exactly at close is fine.
    expect(
      checkSlot({
        hours: CLOSED_WEEKEND,
        tz: TZ,
        startMs: at("2026-08-05T16:30:00", PDT),
        endMs: at("2026-08-05T17:00:00", PDT),
      }),
    ).toBe("ok");
  });

  it("has no opinion when hours were never set, rather than refusing everything", () => {
    // A business mid-setup must still be able to take a booking.
    expect(
      checkSlot({
        hours: [],
        tz: TZ,
        startMs: at("2026-08-05T10:00:00", PDT),
        endMs: at("2026-08-05T10:30:00", PDT),
      }),
    ).toBe("no_hours");
  });

  it("refuses the lunch hour the owner blocked out", () => {
    const lunch = [{ dayOfWeek: null, startTime: "12:00", endTime: "13:00" }];
    expect(
      checkSlot({
        hours: CLOSED_WEEKEND,
        blocks: lunch,
        tz: TZ,
        startMs: at("2026-08-05T12:30:00", PDT),
        endMs: at("2026-08-05T13:00:00", PDT),
      }),
    ).toBe("blocked");
    expect(
      checkSlot({
        hours: CLOSED_WEEKEND,
        blocks: lunch,
        tz: TZ,
        startMs: at("2026-08-05T13:00:00", PDT),
        endMs: at("2026-08-05T13:30:00", PDT),
      }),
    ).toBe("ok");
  });

  it("refuses a one-off closure — the day they shut for a funeral", () => {
    const closure = [
      { startsAt: "2026-08-05T00:00:00-07:00", endsAt: "2026-08-06T00:00:00-07:00" },
    ];
    expect(
      checkSlot({
        hours: CLOSED_WEEKEND,
        blocks: closure,
        tz: TZ,
        startMs: at("2026-08-05T10:00:00", PDT),
        endMs: at("2026-08-05T10:30:00", PDT),
      }),
    ).toBe("blocked");
  });

  it("judges the day in the client's timezone, not the server's", () => {
    // 2026-08-10T02:00Z is Sunday 7pm in Los Angeles — closed — while the UTC
    // date says Monday. A server reading its own clock books it.
    expect(
      checkSlot({
        hours: CLOSED_WEEKEND,
        tz: TZ,
        startMs: Date.parse("2026-08-10T02:00:00Z"),
        endMs: Date.parse("2026-08-10T02:30:00Z"),
      }),
    ).toBe("closed");
  });
});

describe("who a block applies to", () => {
  const blocks = [
    { providerId: null, dayOfWeek: null, startTime: "12:00", endTime: "13:00" }, // shop lunch
    { providerId: "hygienist", dayOfWeek: 5, startTime: "09:00", endTime: "17:00" }, // her Fridays off
  ];

  // The bug: one person's leave was subtracted from EVERYONE's availability, so
  // a hygienist taking Fridays closed the whole practice on Fridays.
  it("does not let one person's leave close the business", () => {
    const wide = businessWideBlocks(blocks);
    expect(wide).toHaveLength(1);
    expect(
      checkSlot({
        hours: MON_FRI,
        blocks: wide,
        tz: TZ,
        startMs: at("2026-08-07T10:00:00", PDT), // Friday
        endMs: at("2026-08-07T10:30:00", PDT),
      }),
    ).toBe("ok");
  });

  it("still keeps that person out of the Friday they booked off", () => {
    expect(
      checkSlot({
        hours: MON_FRI,
        blocks: blocksForProvider(blocks, "hygienist"),
        tz: TZ,
        startMs: at("2026-08-07T10:00:00", PDT),
        endMs: at("2026-08-07T10:30:00", PDT),
      }),
    ).toBe("blocked");
  });

  it("gives a colleague that same Friday", () => {
    expect(
      checkSlot({
        hours: MON_FRI,
        blocks: blocksForProvider(blocks, "dentist"),
        tz: TZ,
        startMs: at("2026-08-07T10:00:00", PDT),
        endMs: at("2026-08-07T10:30:00", PDT),
      }),
    ).toBe("ok");
  });
});

describe("overlapsBlock", () => {
  it("is half-open: touching edges don't collide", () => {
    const lunch = [{ dayOfWeek: null, startTime: "12:00", endTime: "13:00" }];
    // Ends exactly when lunch starts.
    expect(
      overlapsBlock(lunch, TZ, at("2026-08-05T11:30:00", PDT), at("2026-08-05T12:00:00", PDT)),
    ).toBe(false);
    // Starts one minute before it ends → overlaps.
    expect(
      overlapsBlock(lunch, TZ, at("2026-08-05T11:30:00", PDT), at("2026-08-05T12:01:00", PDT)),
    ).toBe(true);
  });

  it("catches a block on the far side of midnight", () => {
    // A late-night slot running into a block that belongs to the NEXT local day
    // was missed when only the start day's blocks were gathered.
    const overnight = [{ dayOfWeek: 4, startTime: "00:00", endTime: "06:00" }]; // Thu early hours
    expect(
      overlapsBlock(overnight, TZ, at("2026-08-05T23:30:00", PDT), at("2026-08-06T00:30:00", PDT)),
    ).toBe(true);
  });

  it("ignores malformed rows instead of throwing mid-call", () => {
    expect(overlapsBlock([{ startTime: "lunch", endTime: "later" }], TZ, 0, 1)).toBe(false);
    expect(overlapsBlock([{}], TZ, 0, 1)).toBe(false);
  });
});
