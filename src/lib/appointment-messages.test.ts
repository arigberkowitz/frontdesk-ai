import { describe, expect, it } from "vitest";
import {
  confirmationText,
  dueForReminder,
  reminderText,
  withinTextingHours,
  type ReminderCandidate,
} from "./appointment-messages";

const HOUR = 3_600_000;
const NOW = Date.parse("2026-08-05T17:00:00Z");

const appt = (over: Partial<ReminderCandidate> = {}): ReminderCandidate => ({
  id: "a1",
  startAt: new Date(NOW + 24 * HOUR),
  customerPhone: "+14155550134",
  customerName: "Dana Reed",
  status: "booked",
  textsAlreadySent: 1,
  ...over,
});

describe("who gets a day-before reminder", () => {
  it("sends to a booked appointment about a day out", () => {
    expect(dueForReminder([appt()], NOW)).toHaveLength(1);
  });

  // The permission rule. Zero prior texts means they never agreed to be
  // texted — the confirmation is the consent record, so no confirmation means
  // no reminder, ever.
  it("never texts someone who never got the confirmation", () => {
    expect(dueForReminder([appt({ textsAlreadySent: 0 })], NOW)).toHaveLength(0);
  });

  it("doesn't text twice", () => {
    expect(dueForReminder([appt({ textsAlreadySent: 2 })], NOW)).toHaveLength(0);
  });

  it("stands down if the owner already texted them by hand", () => {
    // A manual reminder counts. Someone already contacted about tomorrow
    // doesn't need us doing it again.
    expect(dueForReminder([appt({ textsAlreadySent: 2 })], NOW)).toHaveLength(0);
  });

  it("skips cancellations and no-shows", () => {
    expect(dueForReminder([appt({ status: "cancelled" })], NOW)).toHaveLength(0);
    expect(dueForReminder([appt({ status: "no_show" })], NOW)).toHaveLength(0);
  });

  it("skips anyone with no number on file", () => {
    expect(dueForReminder([appt({ customerPhone: null })], NOW)).toHaveLength(0);
  });

  it("covers both ends of tomorrow from one daily sweep", () => {
    const early = appt({ id: "early", startAt: new Date(NOW + 14 * HOUR) });
    const late = appt({ id: "late", startAt: new Date(NOW + 34 * HOUR) });
    expect(dueForReminder([early, late], NOW).map((a) => a.id)).toEqual(["early", "late"]);
  });

  it("leaves alone anything too soon or too far out", () => {
    // Three hours away: they're on their way, a reminder is noise.
    expect(dueForReminder([appt({ startAt: new Date(NOW + 3 * HOUR) })], NOW)).toHaveLength(0);
    // Next week: tomorrow's sweep will get it.
    expect(dueForReminder([appt({ startAt: new Date(NOW + 200 * HOUR) })], NOW)).toHaveLength(0);
    // Already happened.
    expect(dueForReminder([appt({ startAt: new Date(NOW - 2 * HOUR) })], NOW)).toHaveLength(0);
  });
});

describe("texting hours", () => {
  const at = (iso: string) => new Date(iso);

  it("texts during the working day, in the business's own timezone", () => {
    // 17:00 UTC is 10am in Los Angeles and 1pm in New York.
    expect(withinTextingHours(at("2026-08-05T17:00:00Z"), "America/Los_Angeles")).toBe(true);
    expect(withinTextingHours(at("2026-08-05T17:00:00Z"), "America/New_York")).toBe(true);
  });

  it("won't text at 4am", () => {
    // 11:00 UTC is 4am in Los Angeles.
    expect(withinTextingHours(at("2026-08-05T11:00:00Z"), "America/Los_Angeles")).toBe(false);
  });

  it("won't text late at night", () => {
    // 04:00 UTC is 9pm the previous day in Los Angeles.
    expect(withinTextingHours(at("2026-08-06T04:00:00Z"), "America/Los_Angeles")).toBe(false);
  });
});

describe("what the texts say", () => {
  it("confirms with the business, service and time, and an opt-out", () => {
    const body = confirmationText({
      business: "Lawyers for Justice",
      customerName: "Dana Reed",
      serviceName: "Consultation",
      when: "Aug 6, 2026, 2:00 PM",
      callbackNumber: "(408) 832-9827",
    });
    expect(body).toContain("Hi Dana");
    expect(body).toContain("Lawyers for Justice");
    expect(body).toContain("Consultation");
    expect(body).toContain("Aug 6, 2026, 2:00 PM");
    // Required on every message under the A2P campaign we registered.
    expect(body).toContain("Reply STOP to opt out.");
  });

  it("copes with no name rather than saying 'Hi ,'", () => {
    const body = confirmationText({
      business: "Bayside Plumbing",
      customerName: null,
      when: "Thursday at 2",
    });
    expect(body.startsWith("Hi, you're booked")).toBe(true);
    expect(body).not.toContain("Hi  ");
  });

  it("includes a video link when there is one", () => {
    const body = confirmationText({
      business: "Firm",
      customerName: "Sam",
      when: "tomorrow",
      meetingUrl: "https://meet.example/abc",
    });
    expect(body).toContain("https://meet.example/abc");
  });

  it("the reminder reads as a reminder, not a second booking", () => {
    const body = reminderText({ business: "Firm", customerName: "Sam", when: "tomorrow at 2" });
    expect(body).toContain("a reminder of your appointment");
    expect(body).toContain("Reply STOP to opt out.");
  });
});
