import { describe, expect, it } from "vitest";
import {
  inSendWindow,
  localMonthKey,
  recipientSkipReason,
  renderRevenueText,
  statsLine,
  templateProblem,
  type RecipientFacts,
} from "./revenue-texts";

const ok: RecipientFacts = {
  phone: "+14155550100",
  optedOut: false,
  blocked: false,
  spam: false,
  consented: true,
  lastCappedTextAt: null,
  sentTodayByClient: 0,
};
const NOW = new Date("2026-11-20T19:00:00Z"); // 11 AM Pacific

describe("send window: 9 AM to 8 PM in the business's time zone", () => {
  it("opens at 9 and closes at 8 PM local", () => {
    expect(inSendWindow(new Date("2026-11-20T16:59:00Z"), "America/Los_Angeles")).toBe(false); // 8:59
    expect(inSendWindow(new Date("2026-11-20T17:00:00Z"), "America/Los_Angeles")).toBe(true); // 9:00
    expect(inSendWindow(new Date("2026-11-21T03:59:00Z"), "America/Los_Angeles")).toBe(true); // 7:59 PM
    expect(inSendWindow(new Date("2026-11-21T04:00:00Z"), "America/Los_Angeles")).toBe(false); // 8:00 PM
  });
  it("uses the business's zone, not the server's", () => {
    // 11 AM Pacific is 2 PM Eastern; 6 AM Pacific is 9 AM Eastern.
    expect(inSendWindow(new Date("2026-11-20T14:00:00Z"), "America/New_York")).toBe(true);
    expect(inSendWindow(new Date("2026-11-20T14:00:00Z"), "America/Los_Angeles")).toBe(false);
  });
  it("falls back to Pacific on a bad zone instead of throwing", () => {
    expect(inSendWindow(NOW, "Not/AZone")).toBe(true);
  });
  it("keys months in local time", () => {
    // 11 PM Pacific on Nov 30 is already December in UTC.
    expect(localMonthKey(new Date("2026-12-01T07:00:00Z"), "America/Los_Angeles")).toBe("2026-11");
  });
});

describe("who may get a revenue text", () => {
  it("lets a consented, quiet, real customer through", () => {
    expect(recipientSkipReason(ok, NOW)).toBeNull();
  });
  it("honors STOP, blocks, spam and consent, in that order", () => {
    expect(recipientSkipReason({ ...ok, optedOut: true, blocked: true }, NOW)).toBe("opted_out");
    expect(recipientSkipReason({ ...ok, blocked: true }, NOW)).toBe("blocked");
    expect(recipientSkipReason({ ...ok, spam: true }, NOW)).toBe("spam");
    expect(recipientSkipReason({ ...ok, consented: false }, NOW)).toBe("no_consent");
    expect(recipientSkipReason({ ...ok, phone: "12" }, NOW)).toBe("no_phone");
  });
  it("caps one text per person every 3 days across all features", () => {
    const twoDays = new Date(NOW.getTime() - 2 * 86_400_000);
    const fourDays = new Date(NOW.getTime() - 4 * 86_400_000);
    expect(recipientSkipReason({ ...ok, lastCappedTextAt: twoDays }, NOW)).toBe("recently_texted");
    expect(recipientSkipReason({ ...ok, lastCappedTextAt: fourDays }, NOW)).toBeNull();
  });
  it("stops a business at its daily ceiling", () => {
    expect(recipientSkipReason({ ...ok, sentTodayByClient: 50 }, NOW)).toBe("daily_cap");
  });
});

describe("rendering a text", () => {
  it("fills placeholders and always ends with the opt-out line", () => {
    const t = renderRevenueText("Hi {first_name}, it's {business}. About {service}?", {
      business: "Bright Smile Dental",
      firstName: "Maria Lopez",
      service: "your cleaning",
    });
    expect(t).toBe("Hi Maria, it's Bright Smile Dental. About your cleaning? Reply STOP to opt out.");
  });
  it("reads cleanly with no name", () => {
    expect(renderRevenueText("Hi {first_name}, it's {business}.", { business: "Acme HVAC" })).toBe(
      "Hi, it's Acme HVAC. Reply STOP to opt out.",
    );
  });
  it("names the business even when the owner's template doesn't", () => {
    expect(renderRevenueText("Come back soon!", { business: "Acme HVAC" })).toBe(
      "Acme HVAC: Come back soon! Reply STOP to opt out.",
    );
  });
  it("drops unknown placeholders and braces smuggled in through a caller's name", () => {
    const t = renderRevenueText("Hi {first_name} {coupon}, {business}.", { business: "Acme", firstName: "{business}" });
    expect(t).not.toMatch(/[{}]/);
    expect(t).toContain("Reply STOP to opt out.");
  });
  it("uses the Spanish opt-out line for Spanish texts", () => {
    expect(renderRevenueText("Hola, {business}.", { business: "Acme" }, "es")).toBe(
      "Hola, Acme. Responda STOP para no recibir más mensajes.",
    );
  });
});

describe("owner templates", () => {
  it("accepts empty (use default) and plain text", () => {
    expect(templateProblem("")).toBeNull();
    expect(templateProblem("Hi {first_name}, come back to {business}!")).toBeNull();
  });
  it("rejects links and anything too long", () => {
    expect(templateProblem("Book at https://x.com")).toMatch(/links/i);
    expect(templateProblem("x".repeat(301))).toMatch(/300/);
  });
});

describe("results line", () => {
  it("shows real counts and hides when nothing was sent", () => {
    expect(statsLine({ sent: 0, people: 0, failed: 0, replied: 0, bookedAfter: 0 })).toBeNull();
    expect(statsLine({ sent: 12, people: 8, failed: 0, replied: 3, bookedAfter: 2 })).toBe(
      "Last 30 days: 12 texts sent to 8 people · 3 replied · 2 booked afterward",
    );
    expect(statsLine({ sent: 1, people: 1, failed: 2, replied: 0, bookedAfter: 0 })).toContain("2 texts couldn't be sent");
  });
});
