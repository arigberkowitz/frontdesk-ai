import { describe, expect, it } from "vitest";
import { trialSummaryEmail, trialSummarySubject, type TrialSummaryEmailInput } from "./trial-summary-email";

const input = (over: Partial<TrialSummaryEmailInput> = {}): TrialSummaryEmailInput => ({
  businessName: "Nick's Barbershop",
  agentName: "Riley",
  stats: { calls: 23, booked: 6, messages: 4, afterHours: 9 },
  daysLeft: 7,
  aiNumber: "+14155550123",
  answeringMode: "all_calls",
  forwardingDone: true,
  baseUrl: "https://app.test/",
  questionsHtml: "Questions? Just reply to this email.",
  questionsText: "Questions? Just reply to this email.",
  ...over,
});

const allText = (m: { subject: string; html: string; text: string }) => `${m.subject}\n${m.html}\n${m.text}`;

describe("trialSummaryEmail — with calls", () => {
  const m = trialSummaryEmail(input());

  it("shows the four real counts", () => {
    expect(m.text).toContain("Calls answered: 23");
    expect(m.text).toContain("Appointments booked: 6");
    expect(m.text).toContain("Messages taken: 4");
    expect(m.text).toContain("After-hours calls handled: 9");
    expect(m.html).toContain(">23<");
    expect(m.subject).toBe("Nick's Barbershop: your first week — 23 calls answered, 6 booked");
  });

  it("links to the plans, says one flat monthly price, and quotes no money", () => {
    expect(m.html).toContain('href="https://app.test/portal/guidelines?plans=open#plans"');
    expect(m.text).toContain("Pick a plan: https://app.test/portal/guidelines?plans=open#plans");
    expect(allText(m)).toContain("one flat monthly price");
    expect(allText(m)).not.toMatch(/\$\d/);
    expect(allText(m)).not.toMatch(/\/mo\b/);
  });

  it("says how many days are left", () => {
    expect(m.text).toContain("Your free trial has 7 days left.");
  });

  it("leaves out after-hours (and says why) when no hours are saved", () => {
    const n = trialSummaryEmail(input({ stats: { calls: 2, booked: 0, messages: 1, afterHours: null } }));
    expect(n.text).not.toContain("After-hours calls handled");
    expect(n.text).toContain("Add your opening hours");
    expect(n.subject).toBe("Nick's Barbershop: your first week — 2 calls answered");
  });

  it("singular wording for one call", () => {
    const n = trialSummaryEmail(input({ stats: { calls: 1, booked: 0, messages: 0, afterHours: 0 } }));
    expect(n.text).toContain("has answered 1 call for");
  });

  it("escapes the business name", () => {
    const n = trialSummaryEmail(input({ businessName: "<b>Bad & Co</b>" }));
    expect(n.html).toContain("&lt;b&gt;Bad &amp; Co&lt;/b&gt;");
    expect(n.html).not.toContain("<b>Bad");
  });
});

describe("trialSummaryEmail — no calls yet", () => {
  it("number assigned, not forwarded: forwarding steps instead of zeros", () => {
    const m = trialSummaryEmail(
      input({ stats: { calls: 0, booked: 0, messages: 0, afterHours: 0 }, forwardingDone: false }),
    );
    expect(m.text).not.toContain("Calls answered");
    expect(m.text).not.toMatch(/: 0\b/);
    expect(m.text).toContain("isn't forwarded");
    expect(m.text).toContain("(415) 555-0123");
    expect(m.text).toContain("*72 (415) 555-0123");
    expect(m.subject).toBe("Nick's Barbershop: one step left before your AI takes calls");
    expect(allText(m)).toContain("one flat monthly price");
    expect(allText(m)).not.toMatch(/\$\d/);
  });

  it("backup mode gets the no-answer codes, not *72", () => {
    const m = trialSummaryEmail(
      input({ stats: { calls: 0, booked: 0, messages: 0, afterHours: null }, forwardingDone: false, answeringMode: "missed_only" }),
    );
    expect(m.text).toContain("*92 (415) 555-0123");
    expect(m.text).not.toContain("*72");
  });

  it("marked forwarded but silent: asks them to check it", () => {
    const m = trialSummaryEmail(input({ stats: { calls: 0, booked: 0, messages: 0, afterHours: 0 } }));
    expect(m.text).toContain("You marked forwarding as done");
    expect(m.text).toContain("call your business number from another phone");
  });

  it("no number yet: it comes with the first payment", () => {
    const m = trialSummaryEmail(
      input({ stats: { calls: 0, booked: 0, messages: 0, afterHours: null }, aiNumber: null, forwardingDone: false }),
    );
    expect(m.text).toContain("doesn't have its own phone number yet");
    expect(m.text).toContain("It gets one with your first payment");
    expect(m.text).not.toMatch(/finish the setup checklist/);
    expect(m.html).toContain('href="https://app.test/portal"');
    expect(m.html).toContain("Try a test call in your browser");
    expect(m.text).not.toContain("*72");
  });
});

describe("copy rules", () => {
  it("never mentions medical or health businesses", () => {
    for (const calls of [0, 5]) {
      const m = trialSummaryEmail(input({ stats: { calls, booked: 1, messages: 1, afterHours: 1 } }));
      expect(allText(m)).not.toMatch(/medical|health|patient|clinic|dental/i);
    }
  });

  it("subject helper matches the email", () => {
    const i = input();
    expect(trialSummarySubject(i)).toBe(trialSummaryEmail(i).subject);
  });
});
