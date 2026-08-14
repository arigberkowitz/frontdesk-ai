import { describe, expect, it } from "vitest";
import {
  issuesFromCalls,
  issuesFromFailedTexts,
  issuesFromTrials,
  issuesFromWebhooks,
  renderHealthEmail,
} from "@/lib/health-check";

const NOW = new Date("2026-08-14T13:30:00Z");
const DAY = 24 * 60 * 60 * 1000;

describe("issuesFromFailedTexts", () => {
  it("is silent when nothing failed", () => {
    expect(issuesFromFailedTexts([])).toEqual([]);
  });

  // The exact production failure this whole feature exists for: Twilio 401s
  // recorded as the single word "Authenticate", for days, seen by nobody.
  it("flags credential rejection as the platform-down case", () => {
    const issues = issuesFromFailedTexts([
      { clientName: "Lawyers for justice", error: "Authenticate" },
      { clientName: "Lawyers for justice", error: "Authenticate (Twilio 20003)" },
    ]);
    expect(issues[0].severity).toBe("critical");
    expect(issues[0].line).toMatch(/credentials/i);
    expect(issues[0].line).toMatch(/Twilio/);
    // The per-client lines still appear, demoted — the credential line is the story.
    expect(issues).toHaveLength(2);
    expect(issues[1].severity).toBe("warning");
  });

  it("reports ordinary failures per client, as critical", () => {
    const issues = issuesFromFailedTexts([
      { clientName: "Bright Smile Dental", error: "blocked (Twilio 21610)" },
      { clientName: "Bright Smile Dental", error: "landline (Twilio 21614)" },
      { clientName: "Fade Factory", error: null },
    ]);
    expect(issues).toHaveLength(2);
    expect(issues.every((i) => i.severity === "critical")).toBe(true);
    expect(issues[0].line).toContain("Bright Smile Dental: 2 texts");
    expect(issues[1].line).toContain("Fade Factory: 1 text ");
  });
});

describe("issuesFromWebhooks", () => {
  it("says what a stuck Stripe event can cost", () => {
    const issues = issuesFromWebhooks([
      { source: "stripe", eventType: "checkout.session.completed", status: "failed" },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("critical");
    expect(issues[0].line).toMatch(/payment/i);
  });

  it("groups by source", () => {
    const issues = issuesFromWebhooks([
      { source: "retell", eventType: "call_ended", status: "received" },
      { source: "retell", eventType: "call_ended", status: "failed" },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0].line).toContain("2 retell events");
  });
});

describe("issuesFromTrials", () => {
  it("warns ahead of expiry and escalates after it", () => {
    const issues = issuesFromTrials(
      [
        { name: "Expiring Soon LLC", trialEndsAt: new Date(NOW.getTime() + 2 * DAY) },
        { name: "Already Lapsed Inc", trialEndsAt: new Date(NOW.getTime() - DAY) },
        { name: "Fine For Weeks Co", trialEndsAt: new Date(NOW.getTime() + 10 * DAY) },
      ],
      NOW,
    );
    expect(issues).toHaveLength(2);
    const lapsed = issues.find((i) => i.line.includes("Already Lapsed"));
    expect(lapsed?.severity).toBe("critical");
    expect(lapsed?.line).toMatch(/EXPIRED/);
    const soon = issues.find((i) => i.line.includes("Expiring Soon"));
    expect(soon?.severity).toBe("warning");
    expect(soon?.line).toContain("2 days");
  });
});

describe("issuesFromCalls", () => {
  it("stays quiet on a clean call", () => {
    const clean = {
      clientName: "Bright Smile Dental",
      transcript:
        "Agent: Thanks for calling Bright Smile Dental!\nUser: I'd like to book a cleaning. My name is Sam, 415-555-0100.\nAgent: You're booked for Tuesday at 2pm.",
      durationSec: 95,
      outcome: "booked",
    };
    expect(issuesFromCalls([clean])).toEqual([]);
  });

  // The other real production failure: the transfer connected and the call
  // died seconds later, and the dashboard called it a success.
  it("surfaces a dropped transfer", () => {
    // Shaped like Retell's real transcript: the teammate's side of a transfer
    // shows up as "Transfer Target:" lines. One "Hello?" then a dead line.
    const dropped = {
      clientName: "Lawyers for justice",
      transcript:
        "Agent: Hi, thanks for calling Lawyers for justice!\nUser: I need to speak to an agent please.\nAgent: Of course, transferring you now to our team.\nTransfer Target: Hello?",
      durationSec: 19,
      outcome: "escalated",
    };
    const issues = issuesFromCalls([dropped]);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("critical");
    expect(issues[0].line).toContain("Lawyers for justice");
    expect(issues[0].line).toMatch(/transfer/i);
  });
});

describe("renderHealthEmail", () => {
  it("leads with the critical count and keeps sections ordered", () => {
    const { subject, text } = renderHealthEmail(
      [
        { severity: "warning", line: "A trial ends in 2 days." },
        { severity: "critical", line: "Texting is down." },
      ],
      { now: NOW, appUrl: "https://frontdeskai.company" },
    );
    expect(subject).toContain("1 problem");
    expect(text.indexOf("Texting is down")).toBeLessThan(text.indexOf("A trial ends"));
    expect(text).toContain("https://frontdeskai.company/dashboard");
  });

  it("softens the subject when nothing is critical", () => {
    const { subject } = renderHealthEmail(
      [{ severity: "warning", line: "A trial ends in 2 days." }],
      { now: NOW, appUrl: "https://frontdeskai.company" },
    );
    expect(subject).toMatch(/heads-up/);
  });
});
