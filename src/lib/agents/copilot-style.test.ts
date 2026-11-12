import { describe, expect, it } from "vitest";
import { SUPPORT_EMAIL } from "@/config/contact";
import {
  copilotSystemPrompt,
  polishCopilotReply,
  replaceEmDashes,
  splitCopilotMarkup,
} from "./copilot-style";

const NOW = "Thursday, November 12, 2026, 2:59 PM";

describe("copilotSystemPrompt", () => {
  const prompt = copilotSystemPrompt({ businessName: "Bright Smile Dental", now: NOW });

  it("names the business and the current time", () => {
    expect(prompt).toContain("Bright Smile Dental");
    expect(prompt).toContain(NOW);
  });

  it("requires short, plain answers that lead with the fact", () => {
    expect(prompt).toMatch(/Lead with the answer/);
    expect(prompt).toMatch(/1 to 3 short sentences/);
    expect(prompt).toMatch(/Use plain words/);
    expect(prompt).toMatch(/No filler openers or closers/);
    expect(prompt).toContain("Great question");
    expect(prompt).toContain("I'd be happy to");
    expect(prompt).toContain("Let me know if...");
    expect(prompt).toContain("Is there anything else...");
    expect(prompt).toMatch(/No em dashes/);
    expect(prompt).toMatch(/No emoji/);
    expect(prompt).toMatch(/leverage, streamline, seamless, robust/);
    expect(prompt).toMatch(/Do not restate the question/);
    expect(prompt).toMatch(/long bullet list unless they asked/);
  });

  it("forbids inventing facts and unbacked success claims", () => {
    expect(prompt).toMatch(/Never invent a number or fact/);
    expect(prompt).toMatch(/If no tool returned it, say you don't know/);
    expect(prompt).toMatch(/Never claim you added, booked, cancelled, sent, or saved something unless a tool result/);
  });

  it("includes the support-email answer path and Help page", () => {
    const withDefault = copilotSystemPrompt({ businessName: "Bright Smile Dental", now: NOW });
    expect(withDefault).toContain(SUPPORT_EMAIL);
    expect(withDefault).toContain("/portal/settings/help");
    expect(withDefault).toContain(
      `Email ${SUPPORT_EMAIL} or use [Help](/portal/settings/help).`,
    );

    const override = copilotSystemPrompt({
      businessName: "Bright Smile Dental",
      now: NOW,
      supportEmail: "desk@example.com",
    });
    expect(override).toContain("desk@example.com");
    expect(override).toContain("Email desk@example.com or use [Help](/portal/settings/help).");
    expect(override).not.toContain("support@frontdeskai.company");
  });

  it("lists real portal routes for product help, without inventing pages", () => {
    for (const path of [
      "/portal/settings",
      "/portal/settings/phone",
      "/portal/settings/phone#forwarding",
      "/portal/settings/alerts",
      "/portal/settings/calendar",
      "/portal/settings/follow-ups",
      "/portal/settings/team",
      "/portal/settings/help",
      "/portal/guidelines#plans",
      "/portal/knowledge",
      "/portal/services",
      "/portal/calls",
      "/portal/leads",
      "/portal/appointments",
      "/portal",
    ]) {
      expect(prompt).toContain(path);
    }
    expect(prompt).toContain("For your website & other tools");
    expect(prompt).toMatch(/Manage billing/);
    expect(prompt).toMatch(/chat bubble/);
  });
});

describe("polishCopilotReply", () => {
  it("strips a leading sycophantic opener", () => {
    expect(polishCopilotReply("Great question! You had 4 after-hours calls last month.")).toBe(
      "You had 4 after-hours calls last month.",
    );
    expect(
      polishCopilotReply("I'd be happy to help. Priya Shah is waiting on a whitening quote."),
    ).toBe("Priya Shah is waiting on a whitening quote.");
    expect(polishCopilotReply("Of course! Absolutely! You had 2 new leads.")).toBe(
      "You had 2 new leads.",
    );
  });

  it("strips a trailing let-me-know or anything-else line", () => {
    expect(
      polishCopilotReply("You had 4 after-hours calls last month. Let me know if you need anything else!"),
    ).toBe("You had 4 after-hours calls last month.");
    expect(
      polishCopilotReply("Email support@frontdeskai.company or use /portal/settings/help. Is there anything else I can help with?"),
    ).toBe("Email support@frontdeskai.company or use /portal/settings/help.");
    expect(polishCopilotReply("Hope that helps!")).toBe("Hope that helps!");
  });

  it("swaps em dashes for commas or periods without touching numbers or links", () => {
    expect(replaceEmDashes("You had 4 after-hours calls \u2014 see /portal/calls")).toBe(
      "You had 4 after-hours calls, see /portal/calls",
    );
    expect(replaceEmDashes("See /portal/leads \u2014 Priya is waiting.")).toBe(
      "See /portal/leads. Priya is waiting.",
    );
    const money = "Revenue was $1,200 \u2014 3 bookings at $400.";
    expect(polishCopilotReply(money)).toBe("Revenue was $1,200. 3 bookings at $400.");
    expect(polishCopilotReply("Call 415-555-0100 or see 10-15 openings.")).toBe(
      "Call 415-555-0100 or see 10-15 openings.",
    );
    const url = "Read https://frontdeskai.company/portal/calls for the log.";
    expect(polishCopilotReply(url)).toBe(url);
    const path = "Open /portal/leads to see who is waiting.";
    expect(polishCopilotReply(path)).toBe(path);
    // En dashes in ranges stay put.
    expect(polishCopilotReply("There were 3\u20135 after-hours calls.")).toBe(
      "There were 3\u20135 after-hours calls.",
    );
  });

  it("does not empty a reply that is only a closer", () => {
    expect(polishCopilotReply("Let me know if you need anything else.")).toBe(
      "Let me know if you need anything else.",
    );
  });
});

describe("splitCopilotMarkup", () => {
  it("turns a support-email one-liner into a mailto and a Help link", () => {
    const parts = splitCopilotMarkup(
      "Email support@frontdeskai.company or use [Help](/portal/settings/help).",
    );
    expect(parts).toEqual([
      { text: "Email " },
      { text: "support@frontdeskai.company", href: "mailto:support@frontdeskai.company" },
      { text: " or use " },
      { text: "Help", href: "/portal/settings/help" },
      { text: "." },
    ]);
  });

  it("linkifies bare portal paths, including hash targets, and ignores other URLs' paths", () => {
    const parts = splitCopilotMarkup(
      "Forwarding is at /portal/settings/phone#forwarding and plans are at /portal/guidelines#plans.",
    );
    expect(parts).toContainEqual({
      text: "/portal/settings/phone#forwarding",
      href: "/portal/settings/phone#forwarding",
    });
    expect(parts).toContainEqual({
      text: "/portal/guidelines#plans",
      href: "/portal/guidelines#plans",
    });
    const url = splitCopilotMarkup("See https://example.com/portal/leaks for something else.");
    expect(url).toEqual([{ text: "See https://example.com/portal/leaks for something else." }]);
  });
});
