import { describe, expect, it } from "vitest";
import { promisesCodeSend } from "./session";
import { cleanEmail } from "../email-address";

describe("promisesCodeSend", () => {
  it("catches the production reply", () => {
    expect(promisesCodeSend("Let me send a verification code to 415-747-5690.")).toBe(true);
    expect(promisesCodeSend("I'll text you a code now")).toBe(true);
    expect(promisesCodeSend("I've sent a code to that number.")).toBe(true);
  });
  it("ignores unrelated replies", () => {
    expect(promisesCodeSend("What's the zip code for the visit?")).toBe(false);
    // An offer is not a promise — don't force a send the visitor didn't choose.
    expect(promisesCodeSend("I can email the code instead if you prefer.")).toBe(false);
    expect(promisesCodeSend("You're booked for Thursday at 10 AM.")).toBe(false);
  });
});

describe("cleanEmail", () => {
  it("normalises and rejects junk", () => {
    expect(cleanEmail(" A@B.co ")).toBe("a@b.co");
    expect(cleanEmail("nope")).toBeNull();
    expect(cleanEmail("a@b")).toBeNull();
    expect(cleanEmail(undefined)).toBeNull();
  });
});

import { confirmedBy, submittedCode, successClaim } from "./session";

describe("successClaim", () => {
  it("flags completed-action claims", () => {
    expect(successClaim("Got it. Your appointment has been cancelled.")).toBe("cancelled");
    expect(successClaim("You're all booked for Thursday at 10 AM!")).toBe("booked");
    expect(successClaim("I've moved your appointment to Friday.")).toBe("rescheduled");
    expect(successClaim("I've passed your message along to the team.")).toBe("sent");
  });
  it("ignores questions, offers and honest failures", () => {
    expect(successClaim("Want me to cancel it?")).toBeNull();
    expect(successClaim("Should I book 10 AM?")).toBeNull();
    expect(successClaim("Sorry, it wasn't cancelled.")).toBeNull();
    expect(successClaim("We're open 9 to 5.")).toBeNull();
  });
});

describe("confirmedBy / submittedCode", () => {
  it("only success:true confirms", () => {
    expect(confirmedBy("cancel_appointment", '{"success":true}')).toContain("cancelled");
    expect(confirmedBy("cancel_appointment", '{"success":false,"verification_required":true}')).toEqual([]);
    expect(confirmedBy("cancel_appointment", "not json")).toEqual([]);
  });
  it("spots the typed code only after a code prompt", () => {
    const ask = { role: "assistant" as const, content: "I've sent a 6-digit code. Type it here." };
    expect(submittedCode([{ role: "user", content: "cancel" }, ask, { role: "user", content: "364064" }])).toBe("364064");
    expect(submittedCode([{ role: "user", content: "cancel" }, ask, { role: "user", content: "364 064" }])).toBe("364064");
    expect(submittedCode([{ role: "user", content: "hi" }, { role: "assistant", content: "Hello!" }, { role: "user", content: "364064" }])).toBeNull();
  });
});
